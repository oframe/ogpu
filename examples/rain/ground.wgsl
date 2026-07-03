// Wet ground plane: samples the RippleField tile (tRipple: xy = height
// gradient, z = height) to perturb the up normal and modulate a simple
// blinn-phong sheen.

struct Uniforms {
    projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f,
    modelMatrix: mat4x4f,
    cameraPosition: vec3f,
    time: f32,
    uRippleWorldSize: f32,
    uRippleStrength: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var rippleSampler: sampler;
@group(0) @binding(2) var tRipple: texture_2d<f32>;

struct Vertex {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vWorldPos: vec3f,
    @location(1) vUv: vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
    var out: VertexOutput;
    let worldPos = uniforms.modelMatrix * vec4f(in.position, 1.0);
    out.vWorldPos = worldPos.xyz;
    out.vUv = in.uv;
    out.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
    return out;
}

struct FragmentOutput {
    @location(0) color: vec4f,
}

@fragment
fn fs(in: VertexOutput) -> FragmentOutput {
    var out: FragmentOutput;

    let rippleUv = in.vWorldPos.xz / uniforms.uRippleWorldSize;
    let ripple = textureSample(tRipple, rippleSampler, rippleUv);

    let s = uniforms.uRippleStrength;
    let normal = normalize(vec3f(-ripple.x * s, 1.0, -ripple.y * s));

    // cool overhead "sky" light + a warm street-lamp point light
    let viewDir = normalize(uniforms.cameraPosition - in.vWorldPos);

    let skyDir = normalize(vec3f(0.15, 1.0, 0.1));
    let sky = max(dot(normal, skyDir), 0.0);

    let lampPos = vec3f(3.0, 3.5, -2.0);
    let toLamp = lampPos - in.vWorldPos;
    let lampDist2 = dot(toLamp, toLamp);
    let lampDir = toLamp * inverseSqrt(lampDist2);
    let lampAtten = 14.0 / (1.0 + lampDist2);
    let lampDiff = max(dot(normal, lampDir), 0.0) * lampAtten;

    // wet-surface sheen: tight blinn-phong off both lights
    let halfSky = normalize(skyDir + viewDir);
    let halfLamp = normalize(lampDir + viewDir);
    let specSky = pow(max(dot(normal, halfSky), 0.0), 120.0);
    let specLamp = pow(max(dot(normal, halfLamp), 0.0), 90.0) * lampAtten;

    let asphalt = vec3f(0.035, 0.038, 0.045);
    let skyColor = vec3f(0.25, 0.3, 0.4);
    let lampColor = vec3f(1.0, 0.75, 0.45);

    var color = asphalt * (0.25 + 0.6 * sky) * skyColor * 2.5;
    color += asphalt * lampDiff * lampColor * 2.0;
    color += specSky * skyColor * 0.6 + specLamp * lampColor * 1.2;
    // faint brightening on ripple crests
    color *= 1.0 + ripple.z * 0.2;

    out.color = vec4f(color, 1.0);
    return out;
}
