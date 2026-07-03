// Instanced quad renderer for ParticleSystem: pulls Particle data via the
// compacted alive list (instanceCount comes from the indirect draw args).
// Billboard modes: 0 = camera-facing (view-plane), 1 = velocity-stretched.
// Size/color/alpha over life are 4-knot piecewise curves lerped by
// normalized age (immortal particles evaluate at t = 0.5).

struct Uniforms {
    projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f,
    modelMatrix: mat4x4f,
    cameraQuaternion: vec4f,
    time: f32,
    uSize: f32,
    uStretch: f32,
    uBillboard: f32,      // 0 camera-facing, 1 velocity-stretched
    uSizeKnots: vec4f,    // size multiplier at t = 0, 1/3, 2/3, 1
    uAlphaKnots: vec4f,   // alpha at t = 0, 1/3, 2/3, 1
    uColor0: vec4f,       // rgb color knots (w unused)
    uColor1: vec4f,
    uColor2: vec4f,
    uColor3: vec4f,
    uOpacity: f32,
    uSoftness: f32,       // 0 hard disc, 1 fully soft falloff
}

struct Particle {
    position: vec3f,
    age: f32,
    velocity: vec3f,
    life: f32,
    seed: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> aliveList: array<u32>;

struct Vertex {
    @builtin(instance_index) id: u32,
    @location(0) position: vec2f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vUv: vec2f,
    @location(1) vColor: vec4f,
}

fn knotLerp(knots: vec4f, t: f32) -> f32 {
    let s = clamp(t, 0.0, 1.0) * 3.0;
    let i = min(u32(s), 2u);
    let f = s - f32(i);
    return mix(knots[i], knots[i + 1u], f);
}

fn colorLerp(t: f32) -> vec3f {
    let s = clamp(t, 0.0, 1.0) * 3.0;
    if (s < 1.0) { return mix(uniforms.uColor0.rgb, uniforms.uColor1.rgb, s); }
    if (s < 2.0) { return mix(uniforms.uColor1.rgb, uniforms.uColor2.rgb, s - 1.0); }
    return mix(uniforms.uColor2.rgb, uniforms.uColor3.rgb, s - 2.0);
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
    var out: VertexOutput;

    let pIdx = aliveList[in.id];
    let p = particles[pIdx];

    var t = 0.5;
    if (p.life >= 0.0) { t = clamp(p.age / max(p.life, 1e-4), 0.0, 1.0); }

    // per-particle size variation from the emit-time seed
    let size = uniforms.uSize * knotLerp(uniforms.uSizeKnots, t) * mix(0.7, 1.3, p.seed.x);

    let worldPos = uniforms.modelMatrix * vec4f(p.position, 1.0);
    var viewPos = uniforms.viewMatrix * worldPos;

    if (uniforms.uBillboard > 0.5) {
        // velocity-stretched: align the quad's Y with view-space velocity,
        // lengthen along it (rain streaks); falls back to camera-facing
        // when velocity is degenerate in the view plane.
        let velView = (uniforms.viewMatrix * uniforms.modelMatrix * vec4f(p.velocity, 0.0)).xyz;
        let planar = velView.xy;
        if (dot(planar, planar) > 1e-6) {
            let axisY = normalize(planar);
            let axisX = vec2f(-axisY.y, axisY.x);
            let len = size * (1.0 + uniforms.uStretch * length(velView));
            viewPos = vec4f(viewPos.xy + axisX * in.position.x * size + axisY * in.position.y * len, viewPos.z, viewPos.w);
        } else {
            viewPos = vec4f(viewPos.xy + in.position * size, viewPos.z, viewPos.w);
        }
    } else {
        viewPos = vec4f(viewPos.xy + in.position * size, viewPos.z, viewPos.w);
    }

    out.position = uniforms.projectionMatrix * viewPos;
    out.vUv = in.uv;
    out.vColor = vec4f(colorLerp(t), knotLerp(uniforms.uAlphaKnots, t) * uniforms.uOpacity);

    return out;
}

struct FragmentOutput {
    @location(0) color: vec4f,
}

@fragment
fn fs(in: VertexOutput) -> FragmentOutput {
    var out: FragmentOutput;

    let d2 = dot(in.vUv * 2.0 - 1.0, in.vUv * 2.0 - 1.0);
    if (d2 > 1.0) { discard; }

    let falloff = mix(1.0, 1.0 - d2, clamp(uniforms.uSoftness, 0.0, 1.0));
    let alpha = in.vColor.a * falloff;

    // premultiplied output — pairs with one/one-minus-src-alpha or one/one (additive)
    out.color = vec4f(in.vColor.rgb * alpha, alpha);

    return out;
}
