/**
 * gsplatsortworker — CPU depth sort for gaussian splats, off the main thread.
 *
 * The antimatter15/splat approach: a 16-bit counting sort over quantized
 * view-space depths. O(n), single pass over the data, cache-friendly — and
 * because it runs in a worker, it costs the render loop nothing. The GPU only
 * ever sees the finished index buffer.
 *
 * Protocol:
 *   main → worker  { type: 'init', positions: Float32Array (count×4), count }
 *   main → worker  { type: 'sort', modelView: Float32Array(16) }
 *   worker → main  { indices: Uint32Array (transferred), time: ms }
 *
 * Main thread keeps at most one sort in flight (see GaussianSplat._sortCPU);
 * the worker itself just processes messages sequentially.
 */

let positions = null; // Float32Array, vec4 stride (xyz used)
let count = 0;

// Scratch, allocated once at init.
let depths = null; // Float32Array(count) — view-space depth per splat
let buckets = null; // Uint16Array(count) — quantized bucket per splat
const counts = new Uint32Array(65536); // per-bucket tallies / running offsets

self.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'init') {
        positions = msg.positions;
        count = msg.count;
        depths = new Float32Array(count);
        buckets = new Uint16Array(count);
        return;
    }

    // ── sort ──────────────────────────────────────────────────────────────
    const t0 = performance.now();
    const mv = msg.modelView;

    // View-space depth: dist = -(row2 of modelView · position). Positive =
    // in front of the camera (RH, -Z forward) — same key the GPU path uses.
    const mz0 = mv[2],
        mz1 = mv[6],
        mz2 = mv[10],
        mz3 = mv[14];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
        const d = -(mz0 * positions[i * 4] + mz1 * positions[i * 4 + 1] + mz2 * positions[i * 4 + 2] + mz3);
        depths[i] = d;
        if (d < min) min = d;
        if (d > max) max = d;
    }

    // Quantize to 16-bit buckets, INVERTED so ascending bucket order = far →
    // near (painter order, matching the GPU sort's bit-flipped keys).
    counts.fill(0);
    const scale = 65535 / Math.max(max - min, 1e-20);
    for (let i = 0; i < count; i++) {
        const b = 65535 - (((depths[i] - min) * scale) | 0);
        buckets[i] = b;
        counts[b]++;
    }

    // Exclusive prefix sum: counts[b] becomes the first output slot of bucket
    // b. Then scatter — i ascending within a bucket keeps the sort stable, so
    // equal-depth splats never swap between frames (no flicker).
    let sum = 0;
    for (let b = 0; b < 65536; b++) {
        const c = counts[b];
        counts[b] = sum;
        sum += c;
    }
    const indices = new Uint32Array(count); // fresh each sort — transferred away
    for (let i = 0; i < count; i++) {
        indices[counts[buckets[i]]++] = i;
    }

    self.postMessage({ indices, time: performance.now() - t0 }, [indices.buffer]);
};
