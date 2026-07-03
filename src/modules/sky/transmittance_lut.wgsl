// Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique") transmittance LUT: 256×64, Bruneton parametrization
// (x = view-angle distance param, y = altitude param). Recomputed only when
// atmosphere params change. km units throughout.

const PI = 3.14159265358979323846;
const GROUND_R = 6360.0;
const TOP_R = 6460.0;
const STEPS = 40;

struct Uniforms {
    rayleighScatter : vec3f,
    mieScatter : f32,
    ozoneAbsorb : vec3f,
    mieAbsorb : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var lutOut : texture_storage_2d<rgba16float, write>;

// x = rayleigh, y = mie, z = ozone relative densities at altitude h (km).
fn densities(h : f32) -> vec3f {
    return vec3f(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}

fn extinction(h : f32) -> vec3f {
    let d = densities(h);
    return uniforms.rayleighScatter * d.x + vec3f((uniforms.mieScatter + uniforms.mieAbsorb) * d.y) + uniforms.ozoneAbsorb * d.z;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let dims = textureDimensions(lutOut);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(dims);

    // Bruneton uv -> (r, mu): y maps rho = distance-to-horizon, x maps the
    // distance to the top of the atmosphere between its min/max for that r.
    let bigH = sqrt(TOP_R * TOP_R - GROUND_R * GROUND_R);
    let rho = bigH * uv.y;
    let r = sqrt(rho * rho + GROUND_R * GROUND_R);
    let dMin = TOP_R - r;
    let dMax = rho + bigH;
    let d = dMin + uv.x * (dMax - dMin);
    var mu = 1.0;
    if (d > 0.0) {
        mu = (bigH * bigH - rho * rho - d * d) / (2.0 * r * d);
    }
    mu = clamp(mu, -1.0, 1.0);

    // march optical depth from r along mu to the top of the atmosphere
    let dt = d / f32(STEPS);
    let dir = vec2f(sqrt(max(1.0 - mu * mu, 0.0)), mu);
    var tau = vec3f(0.0);
    for (var i = 0; i < STEPS; i++) {
        let t = (f32(i) + 0.5) * dt;
        let p = vec2f(0.0, r) + dir * t;
        let h = max(length(p) - GROUND_R, 0.0);
        tau += extinction(h) * dt;
    }

    textureStore(lutOut, vec2i(id.xy), vec4f(exp(-tau), 1.0));
}
