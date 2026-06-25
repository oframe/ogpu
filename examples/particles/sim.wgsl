struct Uniforms {
    time: f32,
    uDt: f32
}

struct VelocityUniforms {
    uSpatialFreq: f32,
    uTemporalFreq: f32,
    uAmp: f32,
    uIntertia: f32,
    uConstraintRadius: f32
}

//note: intentionally verbose to demonstrate ping-ponging buffers with compute shaders.
//replace ping-pong setup with read_write storage buffers entirely if desired.
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> velocityUniforms: VelocityUniforms;
@group(0) @binding(2) var<storage, read_write> velocityData: array<vec4f>;
@group(0) @binding(3) var<storage, read> positionDataRead: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> positionDataWrite: array<vec4f>;

// 24-feature divergence-free vector field, fitted by the
// curlnetnoise pipeline (target: measured ashima snoiseVec3 FD-curl spectrum;
// matched variance + isotropy). Each feature is a cos+sin pair sharing one
// dot product: two independently polarized modes (elliptical, ABC/Beltrami-
// style swirl) for the price of one transcendental pair.
// Animated: OMEGA[i]*t shifts phases only — exactly divergence-free for all t.
// omega_i = (|k_i|/k_peak)^(2/3): Kolmogorov sweep, finer eddies churn faster.
// Per-feature cost: 1 dot + sincos + 3 fmadd ≈ 16 ALU (~384 total, 48 modes,
// vs ~1800+ for stencil curl of simplex).

const N_F: u32 = 24u;

const K_VEC = array<vec3f, 24>(
    vec3f( -3.89969015,  -0.30518312,   1.05732200),
    vec3f( -0.78239614,  -4.77856243,   0.77559638),
    vec3f( -0.97242285,   2.49177463,   4.48743459),
    vec3f( -0.95363849,   5.64221228,  -0.77025158),
    vec3f(  2.94355374,  -2.08035096,  -5.02045276),
    vec3f( -3.79431837,  -1.08050871,  -4.77405614),
    vec3f(  4.73548235,  -2.81449554,   2.83080127),
    vec3f(  6.00327130,   3.61073228,  -0.29145955),
    vec3f(  3.76673245,   5.38520565,  -2.46576917),
    vec3f(  1.68217548,   3.85457560,   5.62543330),
    vec3f( -5.71687165,   2.67594447,   3.10187448),
    vec3f(  7.01291835,  -1.92541986,   3.20809597),
    vec3f( -3.40680827,  -5.12484102,   5.03200084),
    vec3f( -2.74573526,   2.83393471,  -6.90084684),
    vec3f(  4.63123407,  -4.20527413,  -4.90510150),
    vec3f(  0.55317004,   6.59571792,   5.90763164),
    vec3f( -3.33880699,  -2.38253311,   7.86757120),
    vec3f(  5.18864856,  -6.59495933,   2.88917427),
    vec3f( -5.45889765,  -5.58184834,  -4.22797641),
    vec3f(  9.38746063,   1.40198614,  -1.95623122),
    vec3f( -6.45215965,  -7.21154253,  -0.53257115),
    vec3f(  0.48017366,  -5.19714069,  -8.83239132),
    vec3f( -8.23995196,   6.94291256,  -0.77849476),
    vec3f(  1.92843510,   8.05829509,  -8.28783557)
);

const PHI = array<f32, 24>(
     1.45410954,  4.13940773,  4.45483508,  2.52648027,  1.16779218,  4.95042538,  2.43965183,  1.46604609,  5.83293356,  2.52577912,  4.32061067,  3.89136239,  3.29277871,  0.50486356,  4.61961052,  0.20169127,  5.60548770,  2.18271688,  5.38148000,  3.24238154,  1.97738316,  3.23043735,  4.09243380,  1.13418711
);

const OMEGA = array<f32, 24>(
     0.63275655,  0.71859790,  0.74954996,  0.80124905,  0.83843316,  0.83959234,  0.83961898,  0.91200982,  0.91267179,  0.91306826,  0.91388165,  0.99155705,  0.99161578,  0.99161873,  0.99162263,  1.06692382,  1.06698332,  1.06716454,  1.06747828,  1.13163221,  1.13164634,  1.17544123,  1.21662390,  1.28447766
);

const COEFF = array<vec3f, 24>(
    vec3f( -0.10400217,   0.60951062,  -0.20766038),
    vec3f( -0.66143911,   0.10890406,   0.00373574),
    vec3f( -0.20942115,   0.53808651,  -0.34416908),
    vec3f( -0.53353977,  -0.03757516,   0.38532479),
    vec3f(  0.31294666,   0.58446873,  -0.05870482),
    vec3f(  0.38438118,  -0.50441989,  -0.19133300),
    vec3f(  0.18301517,   0.57709036,   0.26761085),
    vec3f( -0.13590163,   0.27222944,   0.57329837),
    vec3f(  0.14959157,   0.21259065,   0.69281253),
    vec3f( -0.65569791,   0.33772068,  -0.03533433),
    vec3f(  0.17009102,   0.67450943,  -0.26840586),
    vec3f(  0.33660315,   0.50712707,  -0.43145152),
    vec3f(  0.67342845,  -0.26463685,   0.18641090),
    vec3f( -0.59216229,   0.28687097,   0.35341959),
    vec3f( -0.37225131,   0.27400157,  -0.58637617),
    vec3f( -0.31748500,   0.45225206,  -0.47519954),
    vec3f(  0.35705847,  -0.63146178,  -0.03969831),
    vec3f( -0.47760370,  -0.14229848,   0.53290835),
    vec3f( -0.53947481,   0.51023041,   0.02292090),
    vec3f( -0.18266069,   0.55112963,  -0.48156064),
    vec3f(  0.33748379,  -0.34430434,   0.57356868),
    vec3f(  0.54112867,   0.44490455,  -0.23237148),
    vec3f(  0.38563598,   0.40196408,  -0.49688260),
    vec3f(  0.12048744,   0.42403287,   0.44032416)
);

const COEFF_B = array<vec3f, 24>(
    vec3f( -0.12842890,   0.55569300,  -0.31328659),
    vec3f( -0.38891280,  -0.02180549,  -0.52666927),
    vec3f( -0.44534740,   0.37172975,  -0.30291979),
    vec3f( -0.60069773,  -0.06470938,   0.26970984),
    vec3f(  0.08581678,   0.61853282,  -0.20598920),
    vec3f(  0.42161177,  -0.45304284,  -0.23255121),
    vec3f(  0.17405463,   0.57390063,   0.27942906),
    vec3f(  0.02327969,   0.01522086,   0.66806084),
    vec3f(  0.45585314,  -0.05065592,   0.58573378),
    vec3f( -0.54805951,  -0.32627263,   0.38745011),
    vec3f(  0.25948086,   0.68469863,  -0.11244708),
    vec3f(  0.34208446,   0.47531708,  -0.46252527),
    vec3f(  0.62542844,  -0.40492224,   0.01103988),
    vec3f( -0.30601202,   0.57762119,   0.35896591),
    vec3f( -0.46041334,   0.15338056,  -0.56620424),
    vec3f(  0.04281729,   0.48273970,  -0.54297565),
    vec3f( -0.13720916,  -0.66776226,  -0.26044640),
    vec3f( -0.09598571,   0.22415040,   0.68403588),
    vec3f( -0.54149574,   0.15494980,   0.49457786),
    vec3f( -0.16215559,   0.07762124,  -0.72251444),
    vec3f( -0.34391918,   0.26257251,   0.61112705),
    vec3f(  0.71332950,  -0.12810847,   0.11416158),
    vec3f(  0.03989758,  -0.03542153,  -0.73819732),
    vec3f(  0.08835829,   0.43105448,   0.43967540)
);

fn curlNoise(p: vec3f, t: f32) -> vec3f {
    var v = vec3f(0.0);
    for (var i = 0u; i < N_F; i++) {
        let a = dot(K_VEC[i], p) + OMEGA[i] * t + PHI[i];
        v += COEFF[i] * cos(a) + COEFF_B[i] * sin(a);
    }
    return normalize(v);
}

fn hash33(p: vec3f) -> vec3f
{
	var p3 = fract(p * vec3f(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz+33.33);
    return fract((p3.xxy + p3.yxx)*p3.zyx);

}

// single kernel: this sim has no inter-particle coupling (each invocation
// reads only its own pos/vel), so velocity and position integrate in one pass.
// _vel stays in a register between the two halves — no extra buffer round-trip.
// Split into separate dispatches only when phase 2 must read what phase 1 wrote
// for *other* particles (SPH, boids, collisions) — a dispatch boundary is the
// only global sync WebGPU compute gives you.
@compute @workgroup_size(64, 1, 1) fn simulate(
    @builtin(global_invocation_id) global_invocation_id : vec3u
) {
    let id = global_invocation_id.x;
    if (id >= arrayLength(&velocityData)) { return; }

    let pos = positionDataRead[id];
    let vel = velocityData[id];

    //swizzling is not allowed in WGSL so we store a temporary velocity that we can freely mutate
    var _vel = vel.xyz;

    let hash = hash33(pos.xyz * 100.0);
    let curl = curlNoise(pos.xyz * velocityUniforms.uSpatialFreq + (2.0 * hash - 1.0) * 0.1, uniforms.time * velocityUniforms.uTemporalFreq) * velocityUniforms.uAmp;

    _vel += curl * uniforms.uDt;

    let dist = length(pos.xyz);
    if(dist > velocityUniforms.uConstraintRadius) {
        _vel += normalize(pos.xyz) * (velocityUniforms.uConstraintRadius - dist) * 0.3 * uniforms.uDt;
    }

    _vel *= exp(-velocityUniforms.uIntertia * uniforms.uDt);

    velocityData[id] = vec4f(_vel, vel.w);
    positionDataWrite[id] = vec4f(pos.xyz + _vel * uniforms.uDt, pos.w);
}

