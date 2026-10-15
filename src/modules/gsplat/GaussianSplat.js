// GPU Gaussian-splat renderer. Extends Mesh; wraps a depth sort (compute) + EWA splat pipeline.

import { Mesh } from '@core/Mesh';
import { Geometry } from '@core/Geometry';
import { Shader } from '@core/Shader';
import { UniformBuffer } from '@core/UniformBuffer';
import { ComputeShader } from '@core/ComputeShader';
import { Mat4 } from '@math';
import { createStorageBuffer } from '@utils/BufferUtils';
import { BlendFactor } from '@core/GPUEnums.js';

import defaultShaderCode from './gsplat.wgsl?raw';
import sortShaderCode from './gsplatsort.wgsl?raw';
import radixSortShaderCode from './gsplatradixsort.wgsl?raw';

/** Smallest power-of-two that is >= n. */
function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

/** floor(log2(n)) — n must be a power of two and >= 1. */
function log2(n) {
    let l = 0;
    while (n > 1) {
        n >>= 1;
        l++;
    }
    return l;
}

// Reusable scratch matrix for the sort's modelView (camera.viewMatrix × worldMatrix).
const _mv = new Mat4();

export class GaussianSplat extends Mesh {
    /**
     * @param {object} gpu         - Renderer GPU context (`renderer.gpu`).
     * @param {object} options
     * @param {object} options.data   - SplatData produced by SplatLoader.
     * @param {string} [options.code] - Optional override WGSL for the render shader.
     * @param {'bitonic'|'radix'} [options.sortMethod] - GPU sort implementation.
     *   Public property — reassign at runtime (e.g. from a GUI) to switch.
     * @param {'gpu'|'cpu'} [options.sortMode] - Where the sort runs: 'gpu' =
     *   compute shaders in-frame, 'cpu' = async counting sort in a web worker.
     *   Public property — reassign at runtime to switch.
     * @param {number} [options.workgroupSize] - Threads per workgroup for the
     *   sort kernels (64 / 128 / 256). Baked into the WGSL as an override
     *   constant; change at runtime via `setWorkgroupSize()` for profiling.
     * @param {string} [options.label]
     */
    constructor(gpu, { data, code = defaultShaderCode, sortMethod = 'radix', sortMode = 'gpu', workgroupSize = 256, label = 'gaussian-splat' } = {}) {
        // ── Validate input ────────────────────────────────────────────────────
        // Throw rather than soft-fail: Mesh now requires a `geometry` arg, so
        // there is no valid degraded construction path.
        if (!gpu) throw new Error('GaussianSplat: no WebGPU context provided');
        if (!data) throw new Error('GaussianSplat: no splat data provided');

        const { count, positions, colors, rotations, scales } = data;

        // ── Sizing ────────────────────────────────────────────────────────────
        const paddedCount = nextPow2(count);
        const L = log2(paddedCount); // number of bitonic "passes"

        // ── Upload per-splat storage buffers (written once) ───────────────────
        const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

        const positionsBuffer = createStorageBuffer(gpu, {
            label: `${label}-positions`,
            size: positions.byteLength,
            usage: storageUsage,
        });
        gpu.device.queue.writeBuffer(positionsBuffer, 0, positions);

        const colorsBuffer = createStorageBuffer(gpu, {
            label: `${label}-colors`,
            size: colors.byteLength,
            usage: storageUsage,
        });
        gpu.device.queue.writeBuffer(colorsBuffer, 0, colors);

        const rotationsBuffer = createStorageBuffer(gpu, {
            label: `${label}-rotations`,
            size: rotations.byteLength,
            usage: storageUsage,
        });
        gpu.device.queue.writeBuffer(rotationsBuffer, 0, rotations);

        const scalesBuffer = createStorageBuffer(gpu, {
            label: `${label}-scales`,
            size: scales.byteLength,
            usage: storageUsage,
        });
        gpu.device.queue.writeBuffer(scalesBuffer, 0, scales);

        // ── Sort I/O buffers ──────────────────────────────────────────────────
        const sortBufUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        const keysBuffer = createStorageBuffer(gpu, {
            label: `${label}-sort-keys`,
            size: paddedCount * 4,
            usage: sortBufUsage,
        });

        // COPY_SRC: the sorted result gets copied out of this buffer into the
        // render-facing front buffer at the end of every sort.
        const indicesBuffer = createStorageBuffer(gpu, {
            label: `${label}-sort-indices`,
            size: paddedCount * 4,
            usage: sortBufUsage | GPUBufferUsage.COPY_SRC,
        });

        // Front buffer — the ONLY indices the render pipeline ever reads.
        // Every sort mode publishes into it on completion (GPU copy / worker
        // upload), so in-progress sort scribbles in the work buffers are never
        // visible — the prerequisite for the time-sliced mode. Initialised to
        // identity so the first frames draw something sane pre-first-sort.
        const indicesFrontBuffer = gpu.device.createBuffer({
            label: `${label}-sorted-indices-front`,
            size: paddedCount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        {
            const init = new Uint32Array(indicesFrontBuffer.getMappedRange());
            for (let i = 0; i < count; i++) init[i] = i;
            indicesFrontBuffer.unmap();
        }

        // ── Indirect draw buffer: [vertexCount=4, instanceCount=count, 0, 0] ──
        const drawData = new Uint32Array([4, count, 0, 0]);
        const drawBuffer = gpu.device.createBuffer({
            label: `${label}-indirect-draw`,
            size: drawData.byteLength,
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(drawBuffer.getMappedRange()).set(drawData);
        drawBuffer.unmap();

        // ── Corner geometry: 4-vertex triangle-strip, XY corners ∈ {±1} ─────
        const geometry = new Geometry(gpu, {
            data: {
                position: {
                    data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
                    numComponents: 2,
                    type: Float32Array,
                },
            },
            drawBuffer,
        });

        // Corner positions are screen-space, useless for culling — set explicit
        // bounds from the splat centers instead (positions are count×4 vec4s).
        // Pad the radius by 3σ of the largest splat scale so edge splats whose
        // gaussian extends past their center don't pop at the frustum border.
        geometry.computeBoundingSphere({ data: positions, stride: 4 });
        let maxScale = 0;
        for (let i = 0; i < scales.length; i += 4) {
            maxScale = Math.max(maxScale, scales[i], scales[i + 1], scales[i + 2]);
        }
        geometry.bounds.radius += 3 * maxScale;

        // ── Render shader + state ─────────────────────────────────────────────
        const shader = new Shader(gpu, { label, code });
        const uniforms = new UniformBuffer(gpu, shader.uniforms, { uCount: count }, { label: `${label}-uniforms` });

        // ── Mesh base construction ────────────────────────────────────────────
        // Bind group 0: uCount uniform + 5 storage buffers (positions, colors,
        // rotations, scales, sortedIndices). Camera/object live in the engine group.
        super({
            label,
            geometry,
            shader,
            state: {
                topology: 'triangle-strip',
                cullMode: 'none',
                transparent: true,
                depthWrite: false,
                blending: {
                    color: { srcFactor: BlendFactor.ONE, dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA },
                    alpha: { srcFactor: BlendFactor.ONE, dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA },
                },
            },
            bindGroups: [
                shader.bindGroupLayout(0).createBindGroup(
                    {
                        uniforms,
                        positions: positionsBuffer,
                        colors: colorsBuffer,
                        rotations: rotationsBuffer,
                        scales: scalesBuffer,
                        sortedIndices: indicesFrontBuffer,
                    },
                    { label: `${label}-render-bind-group` }
                ),
            ],
        });

        // the new Mesh takes no gpu; the sort passes need it
        this.gpu = gpu;
        this.uniforms = uniforms; // static: the real splat count

        // Active sort implementation — public, hot-swappable per frame.
        this.sortMethod = sortMethod;

        // Where the sort runs: 'gpu' (compute, synchronous-in-frame) or 'cpu'
        // (worker counting sort, async + stale-tolerant). Hot-swappable.
        this.sortMode = sortMode;

        // CPU-mode worker state — worker spun up lazily on first CPU sort.
        this._worker = null;
        this._workerBusy = false;
        this._hasPendingSort = false;
        this._pendingMV = new Float32Array(16);
        this._positionsData = positions; // worker init payload (cloned on post)

        // Stash references needed by sort().
        this._count = count;
        this._paddedCount = paddedCount;
        this._L = L;
        this._positionsBuffer = positionsBuffer;
        this._dataBuffers = [positionsBuffer, colorsBuffer, rotationsBuffer, scalesBuffer];
        this._drawBuffer = drawBuffer;
        this._keysBuffer = keysBuffer;
        this._indicesBuffer = indicesBuffer;
        this._indicesFrontBuffer = indicesFrontBuffer;

        // ── Time-sliced sort state (sortMode 'sliced') ────────────────────────
        // Radix passes per frame — the freshness/frame-cost knob. 2 = a full
        // sort lands every 4 frames at a quarter of the per-frame GPU cost.
        this.slicePasses = 2;
        this._slicing = false; // a sort job is mid-flight across frames
        this._slicePass = 0; // next radix pass to encode
        this._resortQueued = false; // camera moved while a job was in flight

        this._label = label;

        // ── Pre-bake all bitonic step parameters ──────────────────────────────
        // Total steps S = L*(L+1)/2 where L = log2(paddedCount).
        // Each step occupies a 256-byte-aligned slot in one shared buffer.
        // Bind groups are created at init time (one per step) — no per-frame churn.
        const STEP_STRIDE = 256; // GPUDevice minUniformBufferOffsetAlignment = 256
        const totalSteps = (L * (L + 1)) / 2;

        this._totalSteps = totalSteps;

        const stepParamsBuffer = gpu.device.createBuffer({
            label: `${label}-bitonic-step-params`,
            size: Math.max(totalSteps * STEP_STRIDE, STEP_STRIDE),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Write (j, k) pairs into the buffer at STEP_STRIDE-byte offsets.
        const stepData = new Uint32Array(2);
        let stepIdx = 0;
        for (let k = 2; k <= paddedCount; k <<= 1) {
            for (let j = k >> 1; j > 0; j >>= 1) {
                stepData[0] = j;
                stepData[1] = k;
                gpu.device.queue.writeBuffer(stepParamsBuffer, stepIdx * STEP_STRIDE, stepData);
                stepIdx++;
            }
        }

        this._stepParamsBuffer = stepParamsBuffer;
        this._STEP_STRIDE = STEP_STRIDE;

        // ── Radix ping-pong "B" pair (size-independent, created once) ─────────
        // Radix only ever touches the first `count` elements (no pow2 padding
        // needed, unlike bitonic). The "A" pair is keysBuffer/indicesBuffer.
        this._radixPasses = 8; // 32-bit keys / 4 bits per digit
        this._keysBufferB = createStorageBuffer(gpu, {
            label: `${label}-radix-keys-b`,
            size: count * 4,
            usage: sortBufUsage,
        });
        this._indicesBufferB = createStorageBuffer(gpu, {
            label: `${label}-radix-indices-b`,
            size: count * 4,
            usage: sortBufUsage,
        });

        // ── GPU timing of the whole sort pass (timestamp queries) ─────────────
        // `sortTime` = EMA'd milliseconds, readable from a GUI monitor. Only
        // active when the device granted the timestamp-query feature.
        this.sortTime = 0;
        this._timingPending = false;
        this._canTime = gpu.device.features.has('timestamp-query');
        if (this._canTime) {
            this._timingQuerySet = gpu.device.createQuerySet({ type: 'timestamp', count: 2 });
            this._timingResolveBuffer = gpu.device.createBuffer({
                label: `${label}-sort-timing-resolve`,
                size: 16,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this._timingResultBuffer = gpu.device.createBuffer({
                label: `${label}-sort-timing-result`,
                size: 16,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
        }

        // ── Everything that depends on the workgroup size ─────────────────────
        this._workgroupSize = workgroupSize;
        this._buildSortPipelines();
    }

    /**
     * Switch sort workgroup size (64 / 128 / 256) at runtime for profiling.
     * Rebuilds the sort compute pipelines + bind groups; splat data buffers
     * and the render pipeline are untouched.
     */
    setWorkgroupSize(size) {
        if (size === this._workgroupSize) return;
        this._workgroupSize = size;
        this._buildSortPipelines();
    }

    /**
     * Releases every GPU resource the splat owns, terminates the CPU-sort worker and drops
     * the sort shaders out of the hot-reload registry. Remove it from the scene first.
     */
    destroy() {
        super.destroy(); // the engine slot
        this._worker?.terminate();
        this._worker = null;
        this._sortCompute?.destroy();
        this._radixCompute?.destroy();
        this.geometry.destroy();
        for (const buffer of [
            ...this._dataBuffers,
            this._drawBuffer,
            this._keysBuffer,
            this._indicesBuffer,
            this._indicesFrontBuffer,
            this._keysBufferB,
            this._indicesBufferB,
            this._sortUniforms,
            this._stepParamsBuffer,
            this._histogramsBuffer,
            this._radixParamsBuffer,
            this._timingResolveBuffer,
            this._timingResultBuffer,
        ]) {
            buffer?.destroy();
        }
        this._timingQuerySet?.destroy();
        this.uniforms.destroy();
        this.shader.destroy();
    }

    /**
     * (Re)build both sort ComputeShaders and every bind group derived from
     * them, for the current `_workgroupSize`.
     *
     * WORKGROUP_SIZE is an `override` constant in both WGSL files; the engine
     * bakes it into the source pre-compile (utils/wgslOverrides), so changing
     * it means new shader modules — and since bind group layouts hang off the
     * kernels, every bind group follows. The radix histogram buffer and pass
     * params also resize (numWorkgroups = ceil(count / workgroupSize)).
     */
    _buildSortPipelines() {
        // Bind groups are about to be rebuilt — abandon any in-flight sliced
        // job and queue a fresh sort against the new pipelines.
        this._slicing = false;
        this._resortQueued = true;

        const gpu = this.gpu;
        const ws = this._workgroupSize;
        const label = this._label;
        const STEP_STRIDE = this._STEP_STRIDE;
        const count = this._count;
        const sortBufUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

        // Runtime rebuild: deregister the previous shaders from hot-reload and
        // release the size-dependent buffers.
        this._sortCompute?.destroy();
        this._radixCompute?.destroy();
        this._histogramsBuffer?.destroy();
        this._radixParamsBuffer?.destroy();

        // ── Compute shader for depth-key generation + bitonic sort ────────────
        this._sortCompute = new ComputeShader(gpu, {
            label: `${label}-sort-ws-${ws}`,
            code: sortShaderCode,
            constants: { WORKGROUP_SIZE: ws },
        });

        // per-sort uniforms (struct SortUniforms): count/paddedCount fixed, modelViewMatrix per sort()
        this._sortUniforms ??= new UniformBuffer(gpu, this._sortCompute.defs.uniforms.sortUniforms, { count, paddedCount: this._paddedCount }, { label: `${label}-sort-uniforms` });

        // ── Per-step bitonic bind groups ───────────────────────────────────────
        // Unified WGSL binding layout:
        //   @binding(0) keys         (read_write) — shared by both kernels
        //   @binding(1) indices      (read_write) — shared by both kernels
        //   @binding(2) positions    (read)        — computeKeys only
        //   @binding(3) sortUniforms (uniform)     — computeKeys only
        //   @binding(4) stepParams   (uniform)     — bitonicStep only
        // auto-layout for bitonicStep only includes @binding(0,1,4).
        const bitonicLayout = this._sortCompute.bindGroupLayout('bitonicStep', 0);

        this._bitonicBindGroups = [];
        for (let s = 0; s < this._totalSteps; s++) {
            const bg = bitonicLayout.createBindGroup(
                {
                    keys: this._keysBuffer,
                    indices: this._indicesBuffer,
                    // StepParams: two u32s (j, k), padded to 16-byte minimum
                    stepParams: { buffer: this._stepParamsBuffer, offset: s * STEP_STRIDE, size: 16 },
                },
                { label: `step-${s}` }
            );
            this._bitonicBindGroups.push(bg);
        }

        // ── computeKeys bind group (created once; uniforms written per frame) ──
        // auto-layout for computeKeys includes @binding(0,1,2,3).
        this._computeKeysBindGroup = this._sortCompute.bindGroupLayout('computeKeys', 0).createBindGroup(
            {
                keys: this._keysBuffer,
                indices: this._indicesBuffer,
                positions: this._positionsBuffer,
                sortUniforms: this._sortUniforms,
            },
            { label: 'compute-keys' }
        );

        // ══════════════════════════════════════════════════════════════════════
        // Radix sort resources (alternative to bitonic — toggle via sortMethod)
        // ══════════════════════════════════════════════════════════════════════
        // LSD radix: 8 passes × 4 bits over the 32-bit depth keys. Each
        // pass runs histogram → scan → scatter (see gsplatradixsort.wgsl) and
        // ping-pongs keys/indices between the "A" pair (the buffers the render
        // bind group reads) and the "B" pair. 8 passes is even, so the final
        // scatter writes back into the A pair: the render side never needs to
        // know which sort produced the indices.
        const radixWorkgroups = Math.ceil(count / ws);
        this._radixWorkgroups = radixWorkgroups;

        this._radixCompute = new ComputeShader(gpu, {
            label: `${label}-radix-sort-ws-${ws}`,
            code: radixSortShaderCode,
            constants: { WORKGROUP_SIZE: ws },
        });

        // One u32 per (bucket, workgroup) pair, digit-major:
        // histograms[digit * numWorkgroups + workgroup].
        this._histogramsBuffer = createStorageBuffer(gpu, {
            label: `${label}-radix-histograms`,
            size: 16 * radixWorkgroups * 4,
            usage: sortBufUsage,
        });

        // Per-pass PassParams { shift, count, numWorkgroups } at 256-byte
        // aligned slots — same pre-baked-uniform-slots scheme as the bitonic
        // step params.
        this._radixParamsBuffer = gpu.device.createBuffer({
            label: `${label}-radix-pass-params`,
            size: this._radixPasses * STEP_STRIDE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const passData = new Uint32Array(3);
        for (let p = 0; p < this._radixPasses; p++) {
            passData[0] = p * 4; // shift: digit p covers bits [p*4, p*4+4)
            passData[1] = count;
            passData[2] = radixWorkgroups;
            gpu.device.queue.writeBuffer(this._radixParamsBuffer, p * STEP_STRIDE, passData);
        }

        // Pre-bake one bind group per (kernel, pass). Even passes read A and
        // write B; odd passes read B and write A.
        const histLayout = this._radixCompute.bindGroupLayout('histogram', 0);
        const scanLayout = this._radixCompute.bindGroupLayout('scan', 0);
        const scatterLayout = this._radixCompute.bindGroupLayout('scatter', 0);

        this._radixHistBindGroups = [];
        this._radixScanBindGroups = [];
        this._radixScatterBindGroups = [];

        for (let p = 0; p < this._radixPasses; p++) {
            const evenPass = p % 2 === 0;
            const keysIn = evenPass ? this._keysBuffer : this._keysBufferB;
            const indicesIn = evenPass ? this._indicesBuffer : this._indicesBufferB;
            const keysOut = evenPass ? this._keysBufferB : this._keysBuffer;
            const indicesOut = evenPass ? this._indicesBufferB : this._indicesBuffer;
            // PassParams: three u32s, struct size rounds to 16
            const passParams = { buffer: this._radixParamsBuffer, offset: p * STEP_STRIDE, size: 16 };

            // auto-layout per entry point only includes the bindings that
            // kernel actually uses (same trick as the bitonic shader).
            this._radixHistBindGroups.push(histLayout.createBindGroup({ keysIn, histograms: this._histogramsBuffer, passParams }, { label: `radix-histogram-pass-${p}` }));

            this._radixScanBindGroups.push(scanLayout.createBindGroup({ histograms: this._histogramsBuffer, passParams }, { label: `radix-scan-pass-${p}` }));

            this._radixScatterBindGroups.push(
                scatterLayout.createBindGroup({ keysIn, indicesIn, keysOut, indicesOut, histograms: this._histogramsBuffer, passParams }, { label: `radix-scatter-pass-${p}` })
            );
        }
    }

    /**
     * Encode and submit the depth-sort compute pass.
     *
     * Call this BEFORE `renderer.render()` each frame so the vertex shader
     * reads freshly sorted indices.
     *
     * @param {import('@core/Camera').Camera} camera - Active camera.
     * @param {Object} [options]
     * @param {GPUCommandEncoder} [options.encoder] - Chain into the caller's
     *   encoder instead of submitting our own (sortTime isn't sampled then).
     */
    sort(camera, { encoder = null } = {}) {
        if (!camera) return;

        // Ensure world matrices are up to date.
        this.updateMatrixWorld();
        camera.updateMatrixWorld();

        // modelView = viewMatrix * worldMatrix
        _mv.copy(camera.viewMatrix).multiply(this.worldMatrix);

        // CPU mode: hand the matrix to the worker and bail — the sorted
        // indices upload asynchronously whenever the worker answers.
        if (this.sortMode === 'cpu') {
            this._sortCPU(_mv);
            return;
        }

        this._writeSortUniforms(_mv);

        // ── Encode compute passes ─────────────────────────────────────────────
        const ownEncoder = !encoder;
        encoder = encoder ?? this.gpu.device.createCommandEncoder({ label: 'gsplat-sort' });
        const { pass, timing } = this._beginSortPass(encoder, ownEncoder);

        // 1. Compute depth keys and reset indices. Radix never reads past
        //    count; only bitonic needs the padded tail keyed.
        const radix = this.sortMethod === 'radix';
        this._sortCompute.dispatch(encoder, {
            pass,
            kernel: this._sortCompute.findKernel('computeKeys'),
            bindGroup: this._computeKeysBindGroup,
            dispatchCount: [Math.ceil((radix ? this._count : this._paddedCount) / this._workgroupSize), 1, 1],
        });

        // 2. Sort the keys — implementation picked at runtime. Both consume
        //    the keys/indices written by computeKeys and leave the sorted
        //    result in the "A" indices work buffer.
        if (radix) {
            this._encodeRadixSort(encoder, pass);
        } else {
            this._encodeBitonicSort(encoder, pass);
        }

        pass.end();

        // 3. Publish: render reads the front buffer, never the work buffers.
        this._publishIndices(encoder);

        if (ownEncoder) this._submitSort(encoder, timing);
    }

    /**
     * Time-sliced GPU sort (sortMode 'sliced') — spreads one radix sort over
     * several frames so the per-frame GPU cost is a small fixed slice instead
     * of a whole sort. Call EVERY frame (unlike sort()):
     *
     *   splats.sortSliced(camera, cameraMoved);
     *
     * `dirty` marks that the order went stale (camera moved). A new job
     * snapshots the camera ONCE — all passes must agree on a single moment in
     * time, otherwise the result is garbage rather than merely stale — then
     * runs `slicePasses` radix passes per frame. On the last pass the sorted
     * indices are copied into the front buffer in the same submit: the render
     * never sees a half-sorted state, it just keeps using the previous order
     * until the new one lands. Dirty during a job queues an immediate re-sort.
     *
     * Always radix (8 fixed checkpoints); `sortMethod` is ignored here —
     * bitonic's (j,k) network is sliceable too but its step count varies with
     * splat count, so radix keeps the bookkeeping trivial.
     *
     * `encoder` (optional) chains into the caller's encoder, as in sort().
     */
    sortSliced(camera, dirty = true, { encoder = null } = {}) {
        if (!camera) return;
        if (dirty) this._resortQueued = true;
        if (!this._slicing && !this._resortQueued) return; // up to date, idle

        const ownEncoder = !encoder;
        encoder = encoder ?? this.gpu.device.createCommandEncoder({ label: 'gsplat-sliced-sort' });
        const { pass, timing } = this._beginSortPass(encoder, ownEncoder);

        if (!this._slicing) {
            // Begin a new job: freeze the camera snapshot + key the cloud.
            this._resortQueued = false;
            this._slicing = true;
            this._slicePass = 0;

            this.updateMatrixWorld();
            camera.updateMatrixWorld();
            _mv.copy(camera.viewMatrix).multiply(this.worldMatrix);
            this._writeSortUniforms(_mv);

            this._sortCompute.dispatch(encoder, {
                pass,
                kernel: this._sortCompute.findKernel('computeKeys'),
                bindGroup: this._computeKeysBindGroup,
                dispatchCount: [Math.ceil(this._count / this._workgroupSize), 1, 1],
            });
        }

        // This frame's slice of the radix pass sequence.
        const end = Math.min(this._slicePass + this.slicePasses, this._radixPasses);
        while (this._slicePass < end) {
            this._encodeRadixPass(encoder, pass, this._slicePass++);
        }

        pass.end();

        // Job complete → publish atomically with the final pass.
        if (this._slicePass >= this._radixPasses) {
            this._publishIndices(encoder);
            this._slicing = false;
        }

        if (ownEncoder) this._submitSort(encoder, timing);
    }

    // ── Shared sort plumbing ──────────────────────────────────────────────────

    _writeSortUniforms(mv) {
        this._sortUniforms.views.modelViewMatrix.set(mv);
        this._sortUniforms.upload();
    }

    // Bracket the sort pass with timestamps when supported. Skip a frame's
    // measurement while the previous readback is still in flight (mapAsync
    // resolves a few frames later). Never on an external encoder: the result
    // buffer can't be mapped before the caller submits.
    _beginSortPass(encoder, ownEncoder = true) {
        const timing = ownEncoder && this._canTime && !this._timingPending;
        const pass = encoder.beginComputePass({
            label: 'gsplat-sort-pass',
            ...(timing && {
                timestampWrites: {
                    querySet: this._timingQuerySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                },
            }),
        });
        return { pass, timing };
    }

    // Copy the sorted result (always lands in the "A" indices buffer) into the
    // front buffer the render bind group reads. Encoder-level copy: ordered
    // after the compute pass, atomic within the submit.
    _publishIndices(encoder) {
        encoder.copyBufferToBuffer(this._indicesBuffer, 0, this._indicesFrontBuffer, 0, this._count * 4);
    }

    _submitSort(encoder, timing) {
        if (timing) {
            encoder.resolveQuerySet(this._timingQuerySet, 0, 2, this._timingResolveBuffer, 0);
            encoder.copyBufferToBuffer(this._timingResolveBuffer, 0, this._timingResultBuffer, 0, 16);
        }

        this.gpu.device.queue.submit([encoder.finish()]);

        if (timing) {
            this._timingPending = true;
            const result = this._timingResultBuffer;
            result
                .mapAsync(GPUMapMode.READ)
                .then(() => {
                    const t = new BigInt64Array(result.getMappedRange());
                    const ms = Number(t[1] - t[0]) / 1e6;
                    result.unmap();
                    this._timingPending = false;
                    // Light EMA — readable number that still tracks toggles fast.
                    if (ms >= 0) this.sortTime += (ms - this.sortTime) * 0.1;
                })
                // destroy() mid-readback aborts the map
                .catch(() => {});
        }
    }

    // ── Bitonic: one dispatch per (j,k) step, all within the same pass ───────
    // S = L(L+1)/2 steps for L = log2(paddedCount); every step is a full-width
    // compare-and-swap sweep (see gsplatsort.wgsl).
    _encodeBitonicSort(encoder, pass) {
        const bitonicKernel = this._sortCompute.findKernel('bitonicStep');
        for (let s = 0; s < this._totalSteps; s++) {
            this._sortCompute.dispatch(encoder, {
                pass,
                kernel: bitonicKernel,
                bindGroup: this._bitonicBindGroups[s],
                dispatchCount: [Math.ceil(this._paddedCount / this._workgroupSize), 1, 1],
            });
        }
    }

    // ── CPU mode: counting sort in a worker, async indices upload ────────────
    // At most one sort in flight; requests arriving while the worker is busy
    // collapse into a single pending sort with the LATEST matrix (sorting for
    // a camera pose that's already obsolete would be wasted work).
    _sortCPU(mv) {
        if (!this._worker) this._initWorker();

        if (this._workerBusy) {
            this._pendingMV.set(mv);
            this._hasPendingSort = true;
            return;
        }

        this._workerBusy = true;
        this._worker.postMessage({ type: 'sort', modelView: Float32Array.from(mv) });
    }

    _initWorker() {
        this._worker = new Worker(new URL('./gsplatsortworker.js', import.meta.url), {
            type: 'module',
        });

        // Surface worker failures — otherwise CPU mode dies silently and the
        // render just keeps using the last completed order.
        this._worker.onerror = (e) => {
            console.error('[GaussianSplat] sort worker error:', e.message, e);
            this._workerBusy = false;
        };
        this._worker.onmessageerror = (e) => {
            console.error('[GaussianSplat] sort worker message error:', e);
            this._workerBusy = false;
        };

        // Positions ship once (structured-clone copy; the local typed array
        // stays valid for GPU-mode use).
        this._worker.postMessage({
            type: 'init',
            positions: this._positionsData,
            count: this._count,
        });

        this._worker.onmessage = (e) => {
            // The render bind group reads the front buffer — a queue write is
            // all it takes to swap in the new order.
            this.gpu.device.queue.writeBuffer(this._indicesFrontBuffer, 0, e.data.indices);

            // Same EMA the GPU timestamp path feeds — in CPU mode `sortTime`
            // reads as worker milliseconds (off-thread, not frame cost).
            this.sortTime += (e.data.time - this.sortTime) * 0.1;

            this._workerBusy = false;
            if (this._hasPendingSort) {
                this._hasPendingSort = false;
                this._workerBusy = true;
                this._worker.postMessage({
                    type: 'sort',
                    modelView: Float32Array.from(this._pendingMV),
                });
            }
        };
    }

    // ── Radix: 8 passes of histogram → scan → scatter ────────────────────────
    // Dispatches within one compute pass are implicitly ordered, so each
    // kernel sees the previous one's writes (see gsplatradixsort.wgsl).
    _encodeRadixSort(encoder, pass) {
        for (let p = 0; p < this._radixPasses; p++) {
            this._encodeRadixPass(encoder, pass, p);
        }
    }

    // One radix pass (4-bit digit p): the natural checkpoint unit for the
    // time-sliced mode — all state between passes lives in the ping-pong
    // buffers, so the sequence can pause/resume across frames freely.
    _encodeRadixPass(encoder, pass, p) {
        // Per-workgroup bucket counts for this pass's 4-bit digit.
        this._radixCompute.dispatch(encoder, {
            pass,
            kernel: this._radixCompute.findKernel('histogram'),
            bindGroup: this._radixHistBindGroups[p],
            dispatchCount: [this._radixWorkgroups, 1, 1],
        });

        // Exclusive prefix sum → global scatter offsets (single workgroup).
        this._radixCompute.dispatch(encoder, {
            pass,
            kernel: this._radixCompute.findKernel('scan'),
            bindGroup: this._radixScanBindGroups[p],
            dispatchCount: [1, 1, 1],
        });

        // Stable relocation into the ping-pong target pair.
        this._radixCompute.dispatch(encoder, {
            pass,
            kernel: this._radixCompute.findKernel('scatter'),
            bindGroup: this._radixScatterBindGroups[p],
            dispatchCount: [this._radixWorkgroups, 1, 1],
        });
    }
}
