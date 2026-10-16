// validate-prepend: ../../core/engine.wgsl
// ─── Gaussian Splat Renderer ────────────────────────────────────────────────
// Standard 3DGS EWA splatting.  Each splat is drawn as a 4-vertex triangle-strip
// quad (instanced); the VS projects the 2D Gaussian ellipse and the FS evaluates
// the Gaussian fall-off, outputting premultiplied alpha.
//
// Camera/object matrices and viewport come from the engine block (group 1).

struct Uniforms {
    uCount : u32,
}

@group(0) @binding(0) var<uniform>        uniforms      : Uniforms;
@group(0) @binding(1) var<storage, read>  positions     : array<vec4f>;
@group(0) @binding(2) var<storage, read>  colors        : array<vec4f>;
@group(0) @binding(3) var<storage, read>  rotations     : array<vec4f>;
@group(0) @binding(4) var<storage, read>  scales        : array<vec4f>;
@group(0) @binding(5) var<storage, read>  sortedIndices : array<u32>;

// ─── Vertex output ───────────────────────────────────────────────────────────
struct VsOut {
    @builtin(position) position : vec4f,
    @location(0)       vColor   : vec4f, // rgb (gamma) + opacity
    @location(1)       vPos     : vec2f, // gaussian-space coord, |vPos|=3 at quad edge
}

// Build a mat3x3 from a normalised quaternion (x,y,z,w).
fn quatToMat3(q : vec4f) -> mat3x3f {
    let x = q.x; let y = q.y; let z = q.z; let w = q.w;
    let x2 = x + x; let y2 = y + y; let z2 = z + z;
    let xx = x * x2; let xy = x * y2; let xz = x * z2;
    let yy = y * y2; let yz = y * z2; let zz = z * z2;
    let wx = w * x2; let wy = w * y2; let wz = w * z2;
    // Column-major: mat3x3f(col0, col1, col2)
    return mat3x3f(
        vec3f(1.0 - (yy + zz),        xy + wz,         xz - wy),
        vec3f(      xy - wz,     1.0 - (xx + zz),       yz + wx),
        vec3f(      xz + wy,           yz - wx,   1.0 - (xx + yy))
    );
}

@vertex
fn vs(
    @builtin(vertex_index)   vertIdx : u32,
    @builtin(instance_index) instIdx : u32,
    @location(0)             corner  : vec2f,
) -> VsOut {
    var out : VsOut;

    // Degenerate sentinel — nothing to draw.
    let degenerate = vec4f(0.0, 0.0, 2.0, 1.0);

    let splatIdx = sortedIndices[instIdx];
    if (splatIdx >= uniforms.uCount) {
        out.position = degenerate;
        out.vColor   = vec4f(0.0);
        out.vPos     = vec2f(0.0);
        return out;
    }

    // ── Camera-space centre ──────────────────────────────────────────────────

    let pos = positions[splatIdx].xyz;
    let t   = camera.viewMatrix * (object.modelMatrix * vec4f(pos.xyz, 1.0));

    // Near-plane guard (z is negative in front of camera in WebGPU/RH convention).
    if (t.z >= -0.01) {
        out.position = degenerate;
        out.vColor   = vec4f(0.0);
        out.vPos     = vec2f(0.0);
        return out;
    }

    // ── 3-D covariance in object space ──────────────────────────────────────
    // R from quaternion, S = diag(sx,sy,sz), M = R*S  =>  Sigma = M * M^T
    let rot   = rotations[splatIdx];
    let sc    = scales[splatIdx];
    let R     = quatToMat3(rot);
    // Scale columns of R by the corresponding std-dev.
    let M     = mat3x3f(R[0] * sc.x, R[1] * sc.y, R[2] * sc.z);
    let Sigma = M * transpose(M);

    // ── Transform covariance to camera space ────────────────────────────────
    // W = upper-left 3×3 of view * model (model is affine, so view3 * model3).
    let vm = camera.viewMatrix;
    let mm = object.modelMatrix;
    let W  = mat3x3f(vm[0].xyz, vm[1].xyz, vm[2].xyz) * mat3x3f(mm[0].xyz, mm[1].xyz, mm[2].xyz);
    let Vrk = W * Sigma * transpose(W);

    // ── EWA Jacobian ─────────────────────────────────────────────────────────
    // focal lengths from projection matrix diagonal.
    let proj    = camera.projectionMatrix;
    let focal_x = proj[0][0] * camera.viewport.x * 0.5;
    let focal_y = proj[1][1] * camera.viewport.y * 0.5;

    // Clamp tan(fov/2) extents to avoid numerical blowup at extreme angles.
    let limx = 1.3 / proj[0][0]; // 1.3 * tan(fovX/2)
    let limy = 1.3 / proj[1][1]; // 1.3 * tan(fovY/2)
    let tx   = clamp(t.x / t.z, -limx, limx) * t.z;
    let ty   = clamp(t.y / t.z, -limy, limy) * t.z;
    let tz   = t.z;

    let J = mat3x3f(
        vec3f(focal_x / tz,          0.0,  -(focal_x * tx) / (tz * tz)),
        vec3f(0.0,          focal_y / tz,  -(focal_y * ty) / (tz * tz)),
        vec3f(0.0,                    0.0,   0.0)
    );

    // 2×2 projected covariance. With J's columns holding the math-side rows
    // (column-major storage), transpose(J) * Vrk * J equals J · Vrk · Jᵀ in
    // math terms — its upper-left 2×2 is the screen-space covariance.
    let C    = transpose(J) * Vrk * J;
    var cov00 = C[0][0];
    var cov01 = C[1][0];
    var cov11 = C[1][1];

    // Low-pass dilation (prevents aliasing of tiny splats).
    cov00 += 0.3;
    cov11 += 0.3;

    // ── Eigenvectors of the 2×2 covariance ──────────────────────────────────
    let mid    = 0.5 * (cov00 + cov11);
    let disc   = sqrt(max(0.1, mid * mid - (cov00 * cov11 - cov01 * cov01)));
    let lam1   = mid + disc;
    let lam2   = mid - disc;

    if (lam2 < 0.0) {
        out.position = degenerate;
        out.vColor   = vec4f(0.0);
        out.vPos     = vec2f(0.0);
        return out;
    }

    // Major / minor axis directions (pixel-space).
    var eig1 : vec2f;
    if (abs(cov01) < 1e-5) {
        eig1 = vec2f(1.0, 0.0);
    } else {
        eig1 = normalize(vec2f(cov01, lam1 - cov00));
    }
    let eig2 = vec2f(-eig1.y, eig1.x);

    // Axes scaled to 3σ extents so that |vPos| == 3 at the quad boundary.
    // sqrt(2*lambda) gives ≈ σ*sqrt(2); * 3/sqrt(2) = 3σ overall.
    let s1 = min(sqrt(2.0 * lam1), 1024.0);
    let s2 = min(sqrt(2.0 * lam2), 1024.0);
    let majorAxis = eig1 * s1 * 3.0 / sqrt(2.0);
    let minorAxis = eig2 * s2 * 3.0 / sqrt(2.0);

    // ── Quad vertex position ─────────────────────────────────────────────────
    // corner ∈ { (-1,-1), (1,-1), (-1,1), (1,1) } (triangle-strip)
    // Pixel-space offset from projected centre.
    let offset = corner.x * majorAxis + corner.y * minorAxis;

    // Clip-space centre.
    let clip    = proj * t;
    // Add pixel-space offset via homogeneous NDC trick.
    let ndcOff  = offset * 2.0 / camera.viewport;
    out.position = vec4f(clip.xy + ndcOff * clip.w, clip.z, clip.w);

    // Gaussian-space coordinate passed to the fragment shader.
    // At the quad edge corner = ±1, so vPos = ±3 (3σ boundary).
    out.vPos   = corner * 3.0;
    out.vColor = colors[splatIdx];

    return out;
}

// ─── Fragment shader ─────────────────────────────────────────────────────────
@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
    let A     = dot(in.vPos, in.vPos);
    let alpha = exp(-0.5 * A) * in.vColor.a;

    if (alpha < 1.0 / 255.0) {
        discard;
    }

    // Premultiplied alpha output — blending mode: ONE / ONE_MINUS_SRC_ALPHA.
    return vec4f(in.vColor.rgb * alpha, alpha);
}
