// RippleField: analytic rain-impact ripples evaluated into a tileable
// rgba16float texture (xy = normal perturbation gradient, z = height).
// A small ring buffer of ripple events is spawned statistically by rippleSpawn
// (single thread), then rippleEval sums every active ring per texel as an
// expanding damped sinusoid. Distances are toroidal so the tile repeats
// seamlessly under a repeat sampler.

struct RippleUniforms {
    time: f32,
    spawnCount: u32,
    worldSize: f32,     // world-space size of the (square, repeating) tile
    seed: f32,
    speed: f32,         // ring expansion m/s
    damping: f32,       // amplitude decay per second
    amplitude: f32,
    ringWidth: f32,     // gaussian width of the ring packet
    maxAge: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
}

struct Ripple {
    posXZ: vec2f,
    birthTime: f32,
    pad: f32,
}

@group(0) @binding(0) var<uniform> rippleUniforms: RippleUniforms;
@group(0) @binding(1) var<storage, read_write> ripples: array<Ripple>;
@group(0) @binding(2) var<storage, read_write> rippleHead: array<u32>;
@group(0) @binding(3) var tRipple: texture_storage_2d<rgba16float, write>;

fn hash33(p: vec3f) -> vec3f {
    var p3 = fract(p * vec3f(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// single thread: overwrite the oldest ring-buffer slots with new impacts.
// spawnCount is accumulated CPU-side from rain intensity.
@compute @workgroup_size(1) fn rippleSpawn() {
    let count = arrayLength(&ripples);
    var head = rippleHead[0];
    for (var i = 0u; i < rippleUniforms.spawnCount; i++) {
        let h = hash33(vec3f(f32(head) + 0.17, rippleUniforms.time * 61.7, rippleUniforms.seed + f32(i) * 3.31));
        let pos = (h.xy - 0.5) * rippleUniforms.worldSize;
        // birth strictly > 0 so zero-initialized slots read as inactive
        ripples[head % count] = Ripple(pos, max(rippleUniforms.time, 1e-3), 0.0);
        head++;
    }
    rippleHead[0] = head;
}

@compute @workgroup_size(8, 8) fn rippleEval(@builtin(global_invocation_id) gid: vec3u) {
    let dim = textureDimensions(tRipple);
    if (gid.x >= dim.x || gid.y >= dim.y) { return; }

    let size = rippleUniforms.worldSize;
    let uv = (vec2f(gid.xy) + 0.5) / vec2f(dim);
    let world = (uv - 0.5) * size;

    let w = max(rippleUniforms.ringWidth, 1e-3);
    let k = 6.2831853 / (w * 2.0);

    var height = 0.0;
    var grad = vec2f(0.0);

    for (var i = 0u; i < arrayLength(&ripples); i++) {
        let rp = ripples[i];
        let age = rippleUniforms.time - rp.birthTime;
        if (rp.birthTime <= 0.0 || age <= 0.0 || age > rippleUniforms.maxAge) { continue; }

        // toroidal offset -> tile repeats seamlessly
        var d = world - rp.posXZ;
        d -= size * round(d / size);
        let r = length(d);

        let x = r - rippleUniforms.speed * age;
        let gauss = exp(-x * x / (w * w));
        let env = rippleUniforms.amplitude * exp(-rippleUniforms.damping * age) * gauss;

        height += env * sin(k * x);
        // d/dr [env * sin(kx)]: ring carrier + gaussian envelope terms
        let dhdr = env * (k * cos(k * x) - (2.0 * x / (w * w)) * sin(k * x));
        if (r > 1e-4) { grad += (d / r) * dhdr; }
    }

    textureStore(tRipple, vec2i(gid.xy), vec4f(grad, height, 1.0));
}
