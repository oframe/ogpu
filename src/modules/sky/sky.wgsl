// Fullscreen sky background. Drawn at the far plane (depth compare
// 'less-equal', no depth write) so it only fills pixels no opaque mesh
// touched. The view ray is rebuilt from the standard camera uniforms — no
// custom matrices. Samples the sky-view LUT (grading already baked in) and
// adds the sun disk on top.
//
// Lines tagged `// mrt` are stripped by Sky.js for the plain swapchain path.
// With a post composer the MRT contract applies: loc0 = linear HDR color
// (applyGamma = 0), loc1 = world normal — vec4f(0) marks sky for AO/SSR.

const PI = 3.14159265358979323846;

struct Uniforms {
    projectionMatrix : mat4x4f,
    viewMatrix : mat4x4f,
    sunDirection : vec3f,
    sunDiskCos : f32,
    sunColor : vec3f,
    sunDiskSoftness : f32,
    exposure : f32,
    applyGamma : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var tSkyview : texture_2d<f32>;
@group(0) @binding(2) var skySampler : sampler;

struct Vertex {
    @location(0) position : vec3f,
}

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) vDir : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
    var out : VertexOutput;
    out.position = vec4f(in.position.xy, 1.0, 1.0);
    // ndc -> view ray via the perspective terms; view -> world via the
    // transposed (= inverted) camera rotation. Linear in ndc, so it
    // interpolates correctly across the oversized triangle.
    let dirView = vec3f(in.position.x / uniforms.projectionMatrix[0][0], in.position.y / uniforms.projectionMatrix[1][1], -1.0);
    let rot = mat3x3f(uniforms.viewMatrix[0].xyz, uniforms.viewMatrix[1].xyz, uniforms.viewMatrix[2].xyz);
    out.vDir = dirView * rot;
    return out;
}

// world direction -> sky-view LUT uv (mirror of the encode in skyview_lut.wgsl)
fn skyviewUv(dir : vec3f, sunDir : vec3f) -> vec2f {
    let elev = asin(clamp(dir.y, -1.0, 1.0));
    let az = atan2(dir.x, dir.z);
    let sunAz = atan2(sunDir.x, sunDir.z);
    var dPhi = abs(az - sunAz);
    dPhi = min(dPhi, 2.0 * PI - dPhi);
    return vec2f(dPhi / PI, 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5)));
}

fn filmic(x : vec3f) -> vec3f {
    let v = max(vec3f(0.0), x - vec3f(0.004));
    let result = (v * (vec3f(6.2) * v + vec3f(0.5))) / (v * (vec3f(6.2) * v + vec3f(1.7)) + vec3f(0.06));
    return pow(result, vec3f(2.2));
}

struct FragOut {
    @location(0) color : vec4f,
    @location(1) normal : vec4f, // mrt
}

@fragment
fn fs(in : VertexOutput) -> FragOut {
    let dir = normalize(in.vDir);
    let sunDir = normalize(uniforms.sunDirection);

    // SampleLevel: the azimuth wrap makes uv derivatives discontinuous — auto
    // mip selection would draw a seam line opposite the sun.
    var col = textureSampleLevel(tSkyview, skySampler, skyviewUv(dir, sunDir), 0.0).rgb;

    let inner = mix(uniforms.sunDiskCos, 1.0, clamp(uniforms.sunDiskSoftness, 0.05, 1.0));
    col += uniforms.sunColor * smoothstep(uniforms.sunDiskCos, inner, dot(dir, sunDir));

    col *= uniforms.exposure;
    if (uniforms.applyGamma > 0.5) {
        col = filmic(col);
        col = pow(col, vec3f(1.0 / 2.2));
    }

    var out : FragOut;
    out.color = vec4f(col, 1.0);
    out.normal = vec4f(0.0); // mrt
    return out;
}
