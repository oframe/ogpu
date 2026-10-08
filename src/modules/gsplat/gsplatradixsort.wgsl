// ─── Gaussian Splat Radix Sort ──────────────────────────────────────────────
// LSD (least-significant-digit) radix sort over 32-bit keys, 4 bits per pass
// → 16 buckets, 8 passes total.
//
// Where the bitonic sort (gsplatsort.wgsl) repeatedly compare-and-swaps pairs
// in place — O(n·log²n) work, log²n dispatches — radix sort never compares
// keys at all. Each pass looks at one 4-bit digit and relocates every element
// into its digit bucket while preserving the relative order of equal digits
// (stability). Stability is the whole trick: because pass N keeps the order
// produced by passes 0..N-1 within each bucket, sorting digit-by-digit from
// least to most significant yields a fully sorted array after the last pass.
// O(n) work per pass, fixed 8 passes regardless of element count.
//
// One pass = three kernels, dispatched back to back (WebGPU guarantees the
// writes of one dispatch are visible to the next within a compute pass):
//
//   1. histogram — each 256-thread workgroup counts how many of its elements
//      fall into each of the 16 buckets.
//      Output layout is digit-major: histograms[digit * numWorkgroups + wg].
//   2. scan      — one exclusive prefix sum over that flattened array
//      (single-workgroup raking scan).
//      Afterwards histograms[d * numWorkgroups + w] = global destination
//      offset of the FIRST element with digit d inside workgroup w, because
//      everything before it in the flattened order is exactly "all elements
//      with a smaller digit, plus same-digit elements in earlier workgroups".
//   3. scatter   — every element re-reads its digit, computes a stable rank
//      among equal digits within its own workgroup, and writes itself to
//      keysOut[globalOffset + rank].
//
// Keys/indices ping-pong between two buffer pairs (A→B, B→A, …). With an
// even number of passes (8) the final sorted result lands back in pair A —
// the same buffers the render pipeline reads.

// Threads per workgroup AND elements per radix tile — the two are coupled here
// (histogram size, scan length, and scatter's rank loop all scale with it).
// Overridable so the host can profile 64/128/256; the engine bakes it to a
// `const` at compile time (utils/wgslOverrides), which is what lets it appear
// in the workgroup-array sizes below (plain `override` cannot).
// JS must mirror the value (GaussianSplat._workgroupSize) in dispatch counts
// and histogram buffer sizing.
override WORKGROUP_SIZE : u32 = 256;

const RADIX_BUCKETS = 16u; // 2^4 — one bucket per 4-bit digit value
const DIGIT_MASK    = 0xFu;

struct PassParams {
    shift         : u32, // bit offset of this pass's digit: 0, 4, 8, … 28
    count         : u32, // number of real elements to sort
    numWorkgroups : u32, // ceil(count / WORKGROUP_SIZE)
}

// Ping-pong I/O: JS rebinds which physical buffer is "in" vs "out" per pass.
@group(0) @binding(0) var<storage, read>       keysIn     : array<u32>;
@group(0) @binding(1) var<storage, read>       indicesIn  : array<u32>;
@group(0) @binding(2) var<storage, read_write> keysOut    : array<u32>;
@group(0) @binding(3) var<storage, read_write> indicesOut : array<u32>;
@group(0) @binding(4) var<storage, read_write> histograms : array<u32>;
@group(0) @binding(5) var<uniform>             passParams : PassParams;

// ─── 1. histogram ────────────────────────────────────────────────────────────
// Count, per workgroup, how many elements land in each of the 16 buckets.
// Counts are accumulated in fast workgroup memory with atomics, then each of
// the first 16 threads publishes one bucket total to the global array.

var<workgroup> localHist : array<atomic<u32>, RADIX_BUCKETS>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn histogram(
    @builtin(global_invocation_id) gid : vec3u,
    @builtin(local_invocation_id)  lid : vec3u,
    @builtin(workgroup_id)         wid : vec3u,
) {
    if (lid.x < RADIX_BUCKETS) {
        atomicStore(&localHist[lid.x], 0u);
    }
    workgroupBarrier();

    if (gid.x < passParams.count) {
        let digit = (keysIn[gid.x] >> passParams.shift) & DIGIT_MASK;
        atomicAdd(&localHist[digit], 1u);
    }
    workgroupBarrier();

    // Digit-major layout: all workgroup counts for bucket 0 first, then
    // bucket 1, etc. This ordering is what makes the flat prefix sum in the
    // scan kernel directly produce global scatter offsets.
    if (lid.x < RADIX_BUCKETS) {
        histograms[lid.x * passParams.numWorkgroups + wid.x] = atomicLoad(&localHist[lid.x]);
    }
}

// ─── 2. scan ─────────────────────────────────────────────────────────────────
// Exclusive prefix sum over the whole histogram array, in place, as a single
// workgroup. Raking: each lane owns one contiguous segment of
// ceil(total / WORKGROUP_SIZE) entries —
//   1. every lane serially sums its segment,
//   2. one Hillis–Steele scan over the WORKGROUP_SIZE lane totals,
//   3. every lane re-walks its segment writing running exclusive prefixes.
// ~2·log2(WORKGROUP_SIZE) barriers total, independent of count — the old
// chunk-by-chunk scan paid that per 256-entry chunk.

var<workgroup> tile : array<u32, WORKGROUP_SIZE>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn scan(@builtin(local_invocation_id) lid3 : vec3u) {
    let lid    = lid3.x;
    let total  = RADIX_BUCKETS * passParams.numWorkgroups;
    let segLen = (total + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    let start  = min(lid * segLen, total);
    let end    = min(start + segLen, total);

    var sum = 0u;
    for (var i = start; i < end; i++) {
        sum += histograms[i];
    }
    tile[lid] = sum;
    workgroupBarrier();

    // Hillis–Steele inclusive scan: read-before-barrier / write-after-barrier.
    for (var offset = 1u; offset < WORKGROUP_SIZE; offset <<= 1u) {
        var addend = 0u;
        if (lid >= offset) {
            addend = tile[lid - offset];
        }
        workgroupBarrier();
        tile[lid] += addend;
        workgroupBarrier();
    }

    // inclusive → exclusive for this lane's segment start
    var running = tile[lid] - sum;
    for (var i = start; i < end; i++) {
        let v = histograms[i];
        histograms[i] = running;
        running += v;
    }
}

// ─── 3. scatter ──────────────────────────────────────────────────────────────
// Move every element to its sorted position for this digit:
//
//   dst = histograms[digit * numWorkgroups + wg]   // global bucket offset
//       + rank                                     // stable rank inside wg
//
// `rank` = how many elements EARLIER IN THIS WORKGROUP share my digit. Lower
// lane index = earlier original position, so equal digits keep their relative
// order → the sort is stable, which LSD radix requires.
//
// Ranks for ALL 16 buckets are computed at once with a single Hillis–Steele
// inclusive scan over packed counters: each thread contributes a one-hot
// vector (1 in its digit's counter, 0 elsewhere), 16 buckets × 16-bit
// counters packed into 8 u32s. After the scan, thread i's counter for digit d
// holds "how many of lanes 0..i have digit d" — the inclusive count, so
// rank = count - 1. log2(WORKGROUP_SIZE) barrier steps instead of the
// O(WORKGROUP_SIZE) serial loop a naive per-lane count needs.
// 16-bit counters can't overflow: max count = WORKGROUP_SIZE ≤ 256.

const COUNTER_WORDS = RADIX_BUCKETS / 2u; // 16 buckets / two 16-bit halves per u32

var<workgroup> ranks : array<array<u32, COUNTER_WORDS>, WORKGROUP_SIZE>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn scatter(
    @builtin(global_invocation_id) gid : vec3u,
    @builtin(local_invocation_id)  lid : vec3u,
    @builtin(workgroup_id)         wid : vec3u,
) {
    let inBounds = gid.x < passParams.count;

    var key   = 0u;
    var digit = 0u;
    if (inBounds) {
        key   = keysIn[gid.x];
        digit = (key >> passParams.shift) & DIGIT_MASK;
    }

    // Packed one-hot: counter for `digit` lives in word digit/2, in the low
    // (even digit) or high (odd digit) 16 bits. Out-of-bounds lanes stay
    // all-zero so they never disturb anyone's rank.
    let word = digit >> 1u;
    let bit  = (digit & 1u) << 4u; // 0 or 16
    for (var w = 0u; w < COUNTER_WORDS; w++) {
        ranks[lid.x][w] = 0u;
    }
    if (inBounds) {
        ranks[lid.x][word] = 1u << bit;
    }
    workgroupBarrier();

    // Hillis–Steele inclusive scan over the packed counter vectors — same
    // read-before-barrier / write-after-barrier dance as the scan kernel.
    for (var offset = 1u; offset < WORKGROUP_SIZE; offset <<= 1u) {
        var addend : array<u32, COUNTER_WORDS>;
        if (lid.x >= offset) {
            addend = ranks[lid.x - offset];
        }
        workgroupBarrier();
        if (lid.x >= offset) {
            for (var w = 0u; w < COUNTER_WORDS; w++) {
                ranks[lid.x][w] += addend[w];
            }
        }
        workgroupBarrier();
    }

    if (inBounds) {
        let rank = ((ranks[lid.x][word] >> bit) & 0xFFFFu) - 1u; // inclusive → exclusive
        let dst  = histograms[digit * passParams.numWorkgroups + wid.x] + rank;
        keysOut[dst]    = key;
        indicesOut[dst] = indicesIn[gid.x];
    }
}
