// ─── Gaussian Splat Sort ────────────────────────────────────────────────────
// Two compute entry points share one set of bindings.  WebGPU's auto-layout
// derives a separate bind group layout per entry point that only includes the
// bindings actually accessed by that entry — unused bindings are simply absent.
//
//   Binding layout (both kernels see the union):
//     @binding(0) keys         array<u32>  read_write   — sort keys
//     @binding(1) indices      array<u32>  read_write   — sort payload (splat indices)
//     @binding(2) positions    array<vec4f> read        — world-space positions (computeKeys only)
//     @binding(3) sortUniforms SortUniforms uniform      — per-frame MV + counts (computeKeys only)
//     @binding(4) stepParams   StepParams  uniform      — (j,k) per bitonic step (bitonicStep only)

// Threads per workgroup. Overridable so the host can profile 64/128/256 —
// the engine bakes this to a `const` at compile time (see utils/wgslOverrides).
// JS dispatch counts must use the same value (GaussianSplat._workgroupSize).
override WORKGROUP_SIZE : u32 = 256;

// ─── Shared data buffers (used by both entry points) ─────────────────────────
@group(0) @binding(0) var<storage, read_write> keys    : array<u32>;
@group(0) @binding(1) var<storage, read_write> indices : array<u32>;

// ─── computeKeys-only resources ──────────────────────────────────────────────
struct SortUniforms {
    modelViewMatrix : mat4x4f,
    count           : u32,
    paddedCount     : u32,
}

@group(0) @binding(2) var<storage, read> positions    : array<vec4f>;
@group(0) @binding(3) var<uniform>       sortUniforms : SortUniforms;

// ─── bitonicStep-only resources ───────────────────────────────────────────────
struct StepParams {
    j : u32,
    k : u32,
}

@group(0) @binding(4) var<uniform> stepParams : StepParams;

// ─── computeKeys ─────────────────────────────────────────────────────────────
// One thread per padded element.  Computes a back-to-front depth key and
// reinitialises the index buffer so each sort is self-contained.
@compute @workgroup_size(WORKGROUP_SIZE)
fn computeKeys(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x;
    if (i >= sortUniforms.paddedCount) { return; }

    if (i >= sortUniforms.count) {
        // Pad slots beyond the real splat count: sort to the very end.
        keys[i]    = 0xFFFFFFFFu;
        indices[i] = 0xFFFFFFFFu;
        return;
    }

    let pos  = positions[i];
    let view = sortUniforms.modelViewMatrix * vec4f(pos.xyz, 1.0);
    let dist = -view.z; // positive = in front of camera (RH, -Z forward)

    // Back-to-front painter order: farther splats must draw first → smaller key.
    // Positive IEEE-754 floats are bitcast-monotone, so flipping the bit pattern
    // inverts the ordering: large dist → small key.
    //
    // Full 32-bit keys: an earlier 16-bit-quantized variant (top 16 float
    // bits, halving the radix passes) caused visible flicker under camera
    // motion — splat pairs popping between tied (index order) and untied
    // (depth order) as their quantized keys collided frame to frame.
    var key : u32;
    if (dist <= 0.0) {
        key = 0xFFFFFFFFu; // behind/on near plane — push to the very end
    } else {
        key = 0xFFFFFFFFu - bitcast<u32>(dist);
    }

    keys[i]    = key;
    indices[i] = i;
}

// ─── bitonicStep ─────────────────────────────────────────────────────────────
// Standard one-element-per-thread bitonic compare-and-swap.
// Must be called for every (j, k) pair in the outer bitonic loop.
@compute @workgroup_size(WORKGROUP_SIZE)
fn bitonicStep(@builtin(global_invocation_id) gid : vec3u) {
    let i   = gid.x;
    let j   = stepParams.j;
    let k   = stepParams.k;
    let ixj = i ^ j;

    // Each swap pair is processed by exactly one thread (the lower-index one).
    // The upper-bound guard covers paddedCount < dispatch width (count < 256):
    // ixj > i, so checking ixj alone bounds both accesses.
    if (ixj <= i || ixj >= arrayLength(&keys)) { return; }

    let ascending = (i & k) == 0u;
    let ki = keys[i];
    let kj = keys[ixj];

    if ((ki > kj) == ascending) {
        // Swap keys and their associated splat indices together.
        keys[i]    = kj;
        keys[ixj]  = ki;
        let tmp       = indices[i];
        indices[i]    = indices[ixj];
        indices[ixj]  = tmp;
    }
}
