// GPU-resident particle sim: emit/simulate/compact with dead + alive index
// lists (Gareth Thomas GDC14 style). No CPU readback in the frame loop.
// Kernel order per frame: beginFrame -> emit -> writeSimArgs ->
// [gridClear -> gridBuild ->] simulate | simulateBoids.
// Atomic choreography invariants documented in ./CLAUDE.md.

struct SimUniforms {
    dt: f32,
    time: f32,
    requestedEmit: u32,
    flags: u32,              // bit 0: wrap volume enabled
    gravity: vec3f,
    drag: f32,
    wind: vec3f,
    curlAmp: f32,
    curlFreq: f32,
    curlTime: f32,
    attractorStrength: f32,
    pad0: f32,
    attractor: vec3f,
    pad1: f32,
    wrapCenter: vec3f,
    pad2: f32,
    wrapSize: vec3f,
    pad3: f32,
    emitPosition: vec3f,
    emitRadius: f32,
    emitBox: vec3f,          // half extents; any component > 0 => box emitter
    emitSpread: f32,         // 0 = along emitDirection, 1 = fully random
    emitDirection: vec3f,
    pad4: f32,
    speedRange: vec2f,       // min, max
    lifeRange: vec2f,        // min, max seconds; min < 0 => immortal
    separation: f32,
    alignment: f32,
    cohesion: f32,
    neighborRadius: f32,
    maxSpeed: f32,
    maxForce: f32,
    gridCellSize: f32,
    pad5: f32,
    gridOrigin: vec3f,
    pad6: f32,
}

struct Particle {
    position: vec3f,
    age: f32,
    velocity: vec3f,
    life: f32,               // life < 0 => immortal
    seed: vec4f,
}

// All counters atomic: every field is contended by at least one multi-thread
// kernel, and single-thread kernels just use atomicLoad/atomicStore.
struct Counters {
    deadCount: atomic<u32>,
    aliveCountIn: atomic<u32>,
    aliveCountOut: atomic<u32>,
    realEmitCount: atomic<u32>,
}

// drawIndexedIndirect args. indexCount/firstIndex/baseVertex/firstInstance are
// written once from the CPU at init; only instanceCount changes per frame.
struct DrawArgs {
    indexCount: u32,
    instanceCount: atomic<u32>,
    firstIndex: u32,
    baseVertex: u32,
    firstInstance: u32,
}

struct DispatchArgs {
    x: u32,
    y: u32,
    z: u32,
}

@group(0) @binding(0) var<uniform> simUniforms: SimUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> counters: Counters;
@group(0) @binding(3) var<storage, read_write> deadList: array<u32>;
@group(0) @binding(4) var<storage, read_write> aliveIn: array<u32>;
@group(0) @binding(5) var<storage, read_write> aliveOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> drawArgs: DrawArgs;
@group(0) @binding(7) var<storage, read_write> simDispatch: DispatchArgs;
@group(0) @binding(8) var<storage, read_write> gridCounts: array<atomic<u32>>;
@group(0) @binding(9) var<storage, read_write> gridIndices: array<u32>;

// Uniform spatial grid for boids: fixed 32^3 cells, fixed capacity per cell.
// Overflowing particles are dropped from neighbor queries only — they still
// simulate and render (see CLAUDE.md).
const GRID_DIM: i32 = 32;
const NUM_CELLS: u32 = 32768u; // 32^3
const CELL_CAP: u32 = 8u;
const MAX_NEIGHBORS: u32 = 64u;

// 24-feature divergence-free vector field, fitted by the
// curlnetnoise pipeline (target: measured ashima snoiseVec3 FD-curl spectrum;
// matched variance + isotropy). Each feature is a cos+sin pair sharing one
// dot product: two independently polarized modes (elliptical, ABC/Beltrami-
// style swirl) for the price of one transcendental pair.
// Animated: OMEGA[i]*t shifts phases only — exactly divergence-free for all t.
// omega_i = (|k_i|/k_peak)^(2/3): Kolmogorov sweep, finer eddies churn faster.

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

fn hash33(p: vec3f) -> vec3f {
    var p3 = fract(p * vec3f(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// ---------------------------------------------------------------------------
// reset — refill the dead list with every particle index, zero all counters.
// Dispatched at init and from the GUI reset button: ceil(capacity / 64).
@compute @workgroup_size(64) fn reset(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    let capacity = arrayLength(&deadList);
    if (id >= capacity) { return; }

    // reversed so pops (from the top) hand out particle 0 first
    deadList[id] = capacity - 1u - id;

    if (id == 0u) {
        atomicStore(&counters.deadCount, capacity);
        atomicStore(&counters.aliveCountIn, 0u);
        atomicStore(&counters.aliveCountOut, 0u);
        atomicStore(&counters.realEmitCount, 0u);
        atomicStore(&drawArgs.instanceCount, 0u);
        simDispatch.x = 0u;
        simDispatch.y = 1u;
        simDispatch.z = 1u;
    }
}

// ---------------------------------------------------------------------------
// beginFrame — single thread. Clamps the emit request to the dead pool (so
// emit's atomicSub can never underflow), promotes last frame's out-list count
// to this frame's in-count, and zeroes the out-side counters.
@compute @workgroup_size(1) fn beginFrame() {
    let dead = atomicLoad(&counters.deadCount);
    atomicStore(&counters.realEmitCount, min(simUniforms.requestedEmit, dead));
    atomicStore(&counters.aliveCountIn, atomicLoad(&counters.aliveCountOut));
    atomicStore(&counters.aliveCountOut, 0u);
    atomicStore(&drawArgs.instanceCount, 0u);
}

// ---------------------------------------------------------------------------
// emit — pop the dead list, init the particle from emitter uniforms, append
// to aliveIn so newborns simulate the same frame.
// CPU dispatches ceil(requestedEmit / 64); realEmitCount guards the tail.
@compute @workgroup_size(64) fn emit(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= atomicLoad(&counters.realEmitCount)) { return; }

    // safe: beginFrame guaranteed realEmitCount <= deadCount this frame
    let deadSlot = atomicSub(&counters.deadCount, 1u) - 1u;
    let pIdx = deadList[deadSlot];

    let h0 = hash33(vec3f(f32(id) + 0.13, simUniforms.time * 37.19, f32(pIdx) + 0.71));
    let h1 = hash33(vec3f(f32(pIdx) + 0.37, simUniforms.time * 11.31, f32(id) + 0.29));

    var pos = simUniforms.emitPosition;
    if (any(simUniforms.emitBox > vec3f(0.0))) {
        pos += (2.0 * h0 - 1.0) * simUniforms.emitBox;
    } else {
        var r = 2.0 * h0 - 1.0;
        if (dot(r, r) < 1e-6) { r = vec3f(0.0, 1.0, 0.0); }
        pos += normalize(r) * simUniforms.emitRadius * pow(h1.z, 1.0 / 3.0);
    }

    var rndDir = 2.0 * h1 - 1.0;
    if (dot(rndDir, rndDir) < 1e-6) { rndDir = vec3f(0.0, 1.0, 0.0); }
    rndDir = normalize(rndDir);
    var dir = mix(simUniforms.emitDirection, rndDir, simUniforms.emitSpread);
    if (dot(dir, dir) < 1e-6) { dir = rndDir; }
    dir = normalize(dir);

    let speed = mix(simUniforms.speedRange.x, simUniforms.speedRange.y, h0.x);
    var life = mix(simUniforms.lifeRange.x, simUniforms.lifeRange.y, h0.y);
    if (simUniforms.lifeRange.x < 0.0) { life = -1.0; }

    particles[pIdx] = Particle(pos, 0.0, dir * speed, life, vec4f(h0, h1.x));

    let slot = atomicAdd(&counters.aliveCountIn, 1u);
    aliveIn[slot] = pIdx;
}

// ---------------------------------------------------------------------------
// writeSimArgs — single thread, converts aliveCountIn (post-emit) into the
// indirect dispatch size for simulate/gridBuild/simulateBoids.
@compute @workgroup_size(1) fn writeSimArgs() {
    let n = atomicLoad(&counters.aliveCountIn);
    simDispatch.x = (n + 63u) / 64u;
    simDispatch.y = 1u;
    simDispatch.z = 1u;
}

// ---------------------------------------------------------------------------
// shared force + integration helpers

fn baseForce(p: Particle) -> vec3f {
    var force = simUniforms.gravity + simUniforms.wind;
    if (simUniforms.curlAmp > 0.0) {
        force += curlNoise(p.position * simUniforms.curlFreq + (2.0 * p.seed.xyz - 1.0) * 0.1, simUniforms.curlTime) * simUniforms.curlAmp;
    }
    if (simUniforms.attractorStrength != 0.0) {
        let toA = simUniforms.attractor - p.position;
        force += simUniforms.attractorStrength * toA / (1.0 + dot(toA, toA));
    }
    return force;
}

fn integrate(p: ptr<function, Particle>, force: vec3f) {
    let dt = simUniforms.dt;
    var vel = (*p).velocity + force * dt;
    vel *= exp(-simUniforms.drag * dt);
    (*p).velocity = vel;
    (*p).position += vel * dt;

    if ((simUniforms.flags & 1u) != 0u) {
        let size = max(simUniforms.wrapSize, vec3f(1e-3));
        let half = size * 0.5;
        let rel = (*p).position - simUniforms.wrapCenter + half;
        (*p).position = simUniforms.wrapCenter - half + fract(rel / size) * size;
    }
}

// age, expire to the dead list (returns false), or survive (returns true)
fn ageAndCull(p: ptr<function, Particle>, pIdx: u32) -> bool {
    (*p).age += simUniforms.dt;
    if ((*p).life >= 0.0 && (*p).age >= (*p).life) {
        let deadSlot = atomicAdd(&counters.deadCount, 1u);
        deadList[deadSlot] = pIdx;
        return false;
    }
    return true;
}

fn compactOut(p: Particle, pIdx: u32) {
    particles[pIdx] = p;
    let slot = atomicAdd(&counters.aliveCountOut, 1u);
    aliveOut[slot] = pIdx;
    atomicAdd(&drawArgs.instanceCount, 1u);
}

// ---------------------------------------------------------------------------
// simulate — indirect dispatch sized by writeSimArgs.
@compute @workgroup_size(64) fn simulate(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= atomicLoad(&counters.aliveCountIn)) { return; }

    let pIdx = aliveIn[id];
    var p = particles[pIdx];

    if (!ageAndCull(&p, pIdx)) { return; }

    integrate(&p, baseForce(p));
    compactOut(p, pIdx);
}

// ---------------------------------------------------------------------------
// boids: uniform spatial grid

fn cellCoord(pos: vec3f) -> vec3i {
    let c = vec3i(floor((pos - simUniforms.gridOrigin) / max(simUniforms.gridCellSize, 1e-4)));
    return clamp(c, vec3i(0), vec3i(GRID_DIM - 1));
}

fn cellIndex(c: vec3i) -> u32 {
    return u32(c.x) + u32(c.y) * u32(GRID_DIM) + u32(c.z) * u32(GRID_DIM * GRID_DIM);
}

@compute @workgroup_size(64) fn gridClear(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= NUM_CELLS) { return; }
    atomicStore(&gridCounts[gid.x], 0u);
}

// scatter alive particle indices into fixed-capacity cells. The counter keeps
// counting past CELL_CAP but the overflow writes are dropped: those particles
// still simulate and render, they just don't appear as neighbors.
@compute @workgroup_size(64) fn gridBuild(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= atomicLoad(&counters.aliveCountIn)) { return; }

    let pIdx = aliveIn[id];
    let cell = cellIndex(cellCoord(particles[pIdx].position));
    let slot = atomicAdd(&gridCounts[cell], 1u);
    if (slot < CELL_CAP) {
        gridIndices[cell * CELL_CAP + slot] = pIdx;
    }
}

fn clampLength(v: vec3f, maxLen: f32) -> vec3f {
    let len2 = dot(v, v);
    if (len2 > maxLen * maxLen && len2 > 1e-8) {
        return v * (maxLen * inverseSqrt(len2));
    }
    return v;
}

// simulateBoids — alternative to simulate (JS picks which kernel to dispatch).
// Separation/alignment/cohesion over the 27-cell neighborhood, neighbor reads
// capped at MAX_NEIGHBORS, then the same force/life integration as simulate.
@compute @workgroup_size(64) fn simulateBoids(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= atomicLoad(&counters.aliveCountIn)) { return; }

    let pIdx = aliveIn[id];
    var p = particles[pIdx];

    if (!ageAndCull(&p, pIdx)) { return; }

    let home = cellCoord(p.position);
    let r2 = simUniforms.neighborRadius * simUniforms.neighborRadius;

    var sep = vec3f(0.0);
    var velSum = vec3f(0.0);
    var posSum = vec3f(0.0);
    var neighbors = 0u;

    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                if (neighbors >= MAX_NEIGHBORS) { continue; }
                let c = home + vec3i(dx, dy, dz);
                if (any(c < vec3i(0)) || any(c >= vec3i(GRID_DIM))) { continue; }
                let cell = cellIndex(c);
                let count = min(atomicLoad(&gridCounts[cell]), CELL_CAP);
                for (var j = 0u; j < count; j++) {
                    if (neighbors >= MAX_NEIGHBORS) { break; }
                    let qIdx = gridIndices[cell * CELL_CAP + j];
                    if (qIdx == pIdx) { continue; }
                    let q = particles[qIdx];
                    let d = p.position - q.position;
                    let dist2 = dot(d, d);
                    if (dist2 > r2) { continue; }
                    sep += d / max(dist2, 1e-4);
                    velSum += q.velocity;
                    posSum += q.position;
                    neighbors++;
                }
            }
        }
    }

    var steer = vec3f(0.0);
    if (neighbors > 0u) {
        let n = f32(neighbors);
        steer += clampLength(sep * simUniforms.separation, simUniforms.maxForce);
        steer += clampLength((velSum / n - p.velocity) * simUniforms.alignment, simUniforms.maxForce);
        steer += clampLength((posSum / n - p.position) * simUniforms.cohesion, simUniforms.maxForce);
    }

    integrate(&p, baseForce(p) + steer);

    // keep the flock moving: clamp speed into [0.2, 1.0] * maxSpeed
    let speed2 = dot(p.velocity, p.velocity);
    if (speed2 > 1e-8) {
        let speed = sqrt(speed2);
        let clamped = clamp(speed, simUniforms.maxSpeed * 0.2, simUniforms.maxSpeed);
        p.velocity *= clamped / speed;
    }

    compactOut(p, pIdx);
}
