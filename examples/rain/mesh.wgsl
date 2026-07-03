// Rain-reactive mesh: same tRipple sampling as ground.wgsl, projected onto
// world-space XZ and weighted by upward-facing normal so it only bends
// top-facing surfaces (a sphere's underside or a box's sides stay dry).
// Wetness also darkens albedo and boosts specular gloss, scaled by rain
// intensity.

struct Uniforms {
    projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f,
    modelMatrix: mat4x4f,
    normalMatrix: mat3x3f,
    cameraPosition: vec3f,
    time: f32,
    uRippleWorldSize: f32,
    uRippleStrength: f32,
    uWetness: f32,
    uColor: vec3f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var rippleSampler: sampler;
@group(0) @binding(2) var tRipple: texture_2d<f32>;

struct Vertex {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vWorldPos: vec3f,
    @location(1) vNormal: vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
    var out: VertexOutput;
    let worldPos = uniforms.modelMatrix * vec4f(in.position, 1.0);
    out.vWorldPos = worldPos.xyz;
    out.vNormal = normalize(uniforms.normalMatrix * in.normal);
    out.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
    return out;
}

struct FragmentOutput {
    @location(0) color: vec4f,
}

@fragment
fn fs(in: VertexOutput) -> FragmentOutput {
    var out: FragmentOutput;

    let surfaceN = normalize(in.vNormal);
    let upWeight = max(surfaceN.y, 0.0);

    let rippleUv = in.vWorldPos.xz / uniforms.uRippleWorldSize;
    let ripple = textureSample(tRipple, rippleSampler, rippleUv);
    let s = uniforms.uRippleStrength * upWeight;
    let rippleN = normalize(vec3f(-ripple.x * s, 1.0, -ripple.y * s));
    let normal = normalize(mix(surfaceN, rippleN, upWeight));

    let wetness = clamp(upWeight * uniforms.uWetness, 0.0, 1.0);

    // same sky + street-lamp lighting as ground.wgsl, for scene consistency
    let viewDir = normalize(uniforms.cameraPosition - in.vWorldPos);

    let skyDir = normalize(vec3f(0.15, 1.0, 0.1));
    let sky = max(dot(normal, skyDir), 0.0);

    let lampPos = vec3f(3.0, 3.5, -2.0);
    let toLamp = lampPos - in.vWorldPos;
    let lampDist2 = dot(toLamp, toLamp);
    let lampDir = toLamp * inverseSqrt(lampDist2);
    let lampAtten = 14.0 / (1.0 + lampDist2);
    let lampDiff = max(dot(normal, lampDir), 0.0) * lampAtten;

    // wetness darkens albedo, sharpens + boosts specular gloss
    let albedo = uniforms.uColor * mix(1.0, 0.55, wetness);
    let glossPow = mix(24.0, 160.0, wetness);
    let specStrength = mix(0.05, 0.9, wetness);

    let halfSky = normalize(skyDir + viewDir);
    let halfLamp = normalize(lampDir + viewDir);
    let specSky = pow(max(dot(normal, halfSky), 0.0), glossPow);
    let specLamp = pow(max(dot(normal, halfLamp), 0.0), glossPow * 0.75) * lampAtten;

    let skyColor = vec3f(0.25, 0.3, 0.4);
    let lampColor = vec3f(1.0, 0.75, 0.45);

    var color = albedo * (0.2 + 0.6 * sky) * skyColor * 2.2;
    color += albedo * lampDiff * lampColor * 2.0;
    color += (specSky * skyColor * 0.6 + specLamp * lampColor * 1.2) * specStrength;
    // faint brightening on ripple crests, matching the ground's sheen
    color *= 1.0 + ripple.z * 0.15 * wetness;

    out.color = vec4f(color, 1.0);
    return out;
}
