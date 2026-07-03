// GPU-resident particle system: emit/simulate/compact entirely on the GPU
// (dead list + double-buffered alive lists + indirect draw/dispatch), rendered
// as instanced billboard quads. Extends Mesh (GaussianSplat pattern). Call
// `update(encoder, { dt })` every frame BEFORE `renderer.render()`.
// Atomic choreography invariants live in ./CLAUDE.md.

import { Mesh } from '@core/Mesh';
import { Geometry } from '@core/Geometry';
import { RenderPipeline } from '@core/RenderPipeline';
import { ComputeShader } from '@core/ComputeShader';
import { Vec3 } from '@math';
import { createStorageBuffer, createUniformBuffer } from '@utils/BufferUtils';
import { makeStructuredView, primitives } from 'webgpu-utils';

import simCode from './particles_sim.wgsl?raw';
import renderCode from './particles_render.wgsl?raw';
import { PARTICLE_PRESETS } from './presets.js';

// mirror the WGSL grid constants
const GRID_DIM = 32;
const NUM_CELLS = GRID_DIM ** 3;
const CELL_CAP = 8;
const WORKGROUP = 64;

const QUALITY_EMISSION = { low: 0.2, medium: 0.6, high: 1, ultra: 1 };

const DEFAULTS = {
    mode: 'sim',
    emitter: {
        rate: 5000,
        burst: 0,
        position: [0, 0, 0],
        radius: 0.5,
        box: [0, 0, 0], // half extents; any component > 0 overrides radius
        direction: [0, 1, 0],
        spread: 0.5,
        speed: [0.5, 1.5],
        life: [1, 3],
    },
    forces: {
        gravity: [0, 0, 0],
        wind: [0, 0, 0],
        drag: 0.5,
        curlAmp: 0,
        curlFreq: 0.5,
        curlTimeScale: 0.2,
        attractor: [0, 0, 0],
        attractorStrength: 0,
    },
    boids: {
        separation: 0.1,
        alignment: 1,
        cohesion: 0.8,
        neighborRadius: 0.5,
        maxSpeed: 2,
        maxForce: 5,
        center: [0, 0, 0],
        extent: 16, // world size covered by the 32^3 grid
    },
    appearance: {
        size: 0.02,
        blending: 'premultiplied', // or 'additive'
        billboard: 'camera', // or 'stretched'
        stretch: 0,
        opacity: 1,
        softness: 1,
        sizeKnots: [0, 1, 1, 0],
        alphaKnots: [0, 1, 1, 0],
        colors: [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1],
        ],
    },
    wrap: {
        enabled: false,
        center: [0, 0, 0],
        size: [10, 10, 10],
    },
};

const BLEND_MODES = {
    additive: {
        color: { srcFactor: 'one', dstFactor: 'one' },
        alpha: { srcFactor: 'one', dstFactor: 'one' },
    },
    premultiplied: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    },
};

const mergeSection = (...layers) => Object.assign({}, ...layers.filter(Boolean));

function resolveConfig({ preset, mode, emitter, forces, boids, appearance, wrap } = {}) {
    const p = preset ? PARTICLE_PRESETS[preset] : null;
    if (preset && !p) console.warn(`[ParticleSystem] unknown preset '${preset}'`);
    return {
        mode: mode ?? p?.mode ?? DEFAULTS.mode,
        emitter: mergeSection(DEFAULTS.emitter, p?.emitter, emitter),
        forces: mergeSection(DEFAULTS.forces, p?.forces, forces),
        boids: mergeSection(DEFAULTS.boids, p?.boids, boids),
        appearance: mergeSection(DEFAULTS.appearance, p?.appearance, appearance),
        wrap: mergeSection(DEFAULTS.wrap, p?.wrap, wrap),
    };
}

export class ParticleSystem extends Mesh {
    /**
     * @param {object} gpu - renderer.gpu context (never the raw device)
     * @param {object} options
     * @param {number} [options.capacity=100000] fixed particle pool size
     * @param {string} [options.preset] key of PARTICLE_PRESETS
     * @param {object} [options.emitter] emitter overrides (rate, position, radius, box, direction, spread, speed, life, burst)
     * @param {object} [options.forces] force overrides (gravity, wind, drag, curlAmp, curlFreq, attractor, attractorStrength)
     * @param {object} [options.boids] boids overrides (separation, alignment, cohesion, neighborRadius, maxSpeed, maxForce, center, extent)
     * @param {object} [options.appearance] render overrides (size, blending, billboard, stretch, opacity, softness, sizeKnots, alphaKnots, colors)
     * @param {object} [options.wrap] wrap volume { enabled, center, size } (camera-follow re-tiling, used by rain)
     * @param {'sim'|'boids'} [options.mode] which simulate kernel runs (usually set by the preset)
     * @param {object} [options.bounds] explicit cull bounds { center: [x,y,z], radius } — indirect geometry is never auto-culled
     * @param {string} [options.label]
     */
    constructor(gpu, { capacity = 100_000, preset = null, emitter, forces, boids, appearance, wrap, mode, bounds = null, label = 'particle-system' } = {}) {
        if (!gpu) throw new Error('ParticleSystem: no webgpu context provided');

        const config = resolveConfig({ preset, mode, emitter, forces, boids, appearance, wrap });
        const { device } = gpu;

        // ── storage buffers ──────────────────────────────────────────────────
        const particleBuffer = createStorageBuffer(gpu, {
            label: `${label}-particles`,
            size: capacity * 48,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // COPY_SRC for the opt-in debug counter readback
        const countersBuffer = createStorageBuffer(gpu, {
            label: `${label}-counters`,
            size: 16,
        });

        const deadListBuffer = createStorageBuffer(gpu, {
            label: `${label}-dead-list`,
            size: capacity * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        const aliveBuffers = [0, 1].map((i) =>
            createStorageBuffer(gpu, {
                label: `${label}-alive-list-${i}`,
                size: capacity * 4,
                usage: GPUBufferUsage.STORAGE,
            })
        );

        // drawIndexedIndirect args: [indexCount, instanceCount, firstIndex,
        // baseVertex, firstInstance] — Quad is indexed, so 5 fields.
        // createStorageBuffer's default usage lacks INDIRECT: pass it explicitly.
        const drawBuffer = createStorageBuffer(gpu, {
            label: `${label}-draw-args`,
            size: 5 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        });

        const simDispatchBuffer = createStorageBuffer(gpu, {
            label: `${label}-sim-dispatch`,
            size: 3 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        });

        const gridCountsBuffer = createStorageBuffer(gpu, {
            label: `${label}-grid-counts`,
            size: NUM_CELLS * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        const gridIndicesBuffer = createStorageBuffer(gpu, {
            label: `${label}-grid-indices`,
            size: NUM_CELLS * CELL_CAP * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        // ── geometry: indexed unit quad, indirect-drawn ──────────────────────
        const geometry = new Geometry(gpu, { data: primitives.createXYQuadVertices({ size: 2 }), drawBuffer });
        if (!geometry.nonInstancedVerts.indexBuffer) {
            throw new Error('ParticleSystem: quad geometry must be indexed (drawIndexedIndirect expects 5 args)');
        }
        const indexCount = geometry.nonInstancedVerts.numElements;
        device.queue.writeBuffer(drawBuffer, 0, new Uint32Array([indexCount, 0, 0, 0, 0]));

        // indirect geometry is never auto-culled — set bounds explicitly
        const boundsCenter = new Vec3().fromArray(bounds?.center ?? config.emitter.position);
        const boundsRadius = bounds?.radius ?? 1000;
        geometry.bounds = {
            min: new Vec3().copy(boundsCenter).sub(new Vec3(boundsRadius, boundsRadius, boundsRadius)),
            max: new Vec3().copy(boundsCenter).add(new Vec3(boundsRadius, boundsRadius, boundsRadius)),
            center: boundsCenter,
            scale: new Vec3(boundsRadius * 2, boundsRadius * 2, boundsRadius * 2),
            radius: boundsRadius,
        };

        // ── render pipelines: one per blend mode, hot-swappable ─────────────
        const pipelines = {};
        for (const blendMode of Object.keys(BLEND_MODES)) {
            pipelines[blendMode] = new RenderPipeline(gpu, {
                label: `${label}-render-${blendMode}`,
                code: renderCode,
                vertexBuffers: geometry.bufferLayouts,
                cullMode: 'none',
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: BLEND_MODES[blendMode],
            });
        }
        const pipeline = pipelines[config.appearance.blending] ?? pipelines.premultiplied;

        // render bind group per frame parity: reads the alive list simulate
        // just wrote (out list of parity p = aliveBuffers[1 - p]).
        let renderBGs;
        super(gpu, {
            label,
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => {
                renderBGs = [0, 1].map((p) =>
                    device.createBindGroup({
                        label: `${label}-render-bind-group-${p}`,
                        layout: pipeline.bindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniformBuffer } },
                            { binding: 1, resource: { buffer: particleBuffer } },
                            { binding: 2, resource: { buffer: aliveBuffers[1 - p] } },
                        ],
                    })
                );
                return [renderBGs[0]];
            },
        });

        this.capacity = capacity;
        this.preset = preset;
        this.mode = config.mode;
        this.emitter = config.emitter;
        this.forces = config.forces;
        this.boids = config.boids;
        this.appearance = config.appearance;
        this.wrap = config.wrap;

        this.emissionScale = 1;
        this.debugCounters = false;

        this._renderBGs = renderBGs;
        this._pipelines = pipelines;
        this._particleBuffer = particleBuffer;
        this._countersBuffer = countersBuffer;
        this._deadListBuffer = deadListBuffer;
        this._aliveBuffers = aliveBuffers;
        this._drawBuffer = drawBuffer;
        this._simDispatchBuffer = simDispatchBuffer;
        this._gridCountsBuffer = gridCountsBuffer;
        this._gridIndicesBuffer = gridIndicesBuffer;

        this._frame = 0;
        this._time = 0;
        this._emitAccum = 0;
        this._pendingBurst = config.emitter.burst || 0;
        this._debugPending = false;
        this._debugStaging = device.createBuffer({
            label: `${label}-counters-staging`,
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        // ── compute: one module, one pipeline per kernel ─────────────────────
        this._compute = new ComputeShader(gpu, {
            label: `${label}-sim`,
            code: simCode,
        });

        this._simUniforms = makeStructuredView(this._compute.defs.uniforms.simUniforms);
        this._simUniformBuffer = createUniformBuffer(gpu, {
            label: `${label}-sim-uniforms`,
            size: this._simUniforms.arrayBuffer.byteLength,
        });

        this._buildSimBindGroups();
        this._applyAppearance();
        this.reset();
    }

    // Bind groups per kernel — auto layouts only contain each kernel's
    // statically-used bindings. Alive-list kernels get one variant per frame
    // parity: parity p reads aliveBuffers[p], writes aliveBuffers[1 - p].
    _buildSimBindGroups() {
        const { device } = this.gpu;
        const resource = (binding, parity) => {
            const buffer = {
                0: this._simUniformBuffer,
                1: this._particleBuffer,
                2: this._countersBuffer,
                3: this._deadListBuffer,
                4: this._aliveBuffers[parity], // aliveIn
                5: this._aliveBuffers[1 - parity], // aliveOut
                6: this._drawBuffer,
                7: this._simDispatchBuffer,
                8: this._gridCountsBuffer,
                9: this._gridIndicesBuffer,
            }[binding];
            return { binding, resource: { buffer } };
        };

        const make = (kernelName, bindings, parity = 0) =>
            device.createBindGroup({
                label: `${this.label}-${kernelName}-bg-${parity}`,
                layout: this._compute.bindGroupLayout(kernelName),
                entries: bindings.map((b) => resource(b, parity)),
            });
        const makePair = (kernelName, bindings) => [0, 1].map((p) => make(kernelName, bindings, p));

        this._bg = {
            reset: make('reset', [2, 3, 6, 7]),
            beginFrame: make('beginFrame', [0, 2, 6]),
            emit: makePair('emit', [0, 1, 2, 3, 4]),
            writeSimArgs: make('writeSimArgs', [2, 7]),
            simulate: makePair('simulate', [0, 1, 2, 3, 4, 5, 6]),
            gridClear: make('gridClear', [8]),
            gridBuild: makePair('gridBuild', [0, 1, 2, 4, 8, 9]),
            simulateBoids: makePair('simulateBoids', [0, 1, 2, 3, 4, 5, 6, 8, 9]),
        };
    }

    _applyAppearance() {
        const a = this.appearance;
        this.uniforms.set({
            uSize: a.size,
            uStretch: a.stretch,
            uBillboard: a.billboard === 'stretched' ? 1 : 0,
            uSizeKnots: a.sizeKnots,
            uAlphaKnots: a.alphaKnots,
            uColor0: [...a.colors[0], 1],
            uColor1: [...a.colors[1], 1],
            uColor2: [...a.colors[2], 1],
            uColor3: [...a.colors[3], 1],
            uOpacity: a.opacity,
            uSoftness: a.softness,
        });
    }

    _writeSimUniforms(dt, requestedEmit) {
        const f = this.forces;
        const e = this.emitter;
        const b = this.boids;
        // cell size covers both the boids neighborhood and the grid extent
        const cellSize = Math.max(b.extent / GRID_DIM, b.neighborRadius, 1e-3);
        const half = (cellSize * GRID_DIM) / 2;

        this._simUniforms.set({
            dt,
            time: this._time,
            requestedEmit,
            flags: this.wrap.enabled ? 1 : 0,
            gravity: f.gravity,
            drag: f.drag,
            wind: f.wind,
            curlAmp: f.curlAmp,
            curlFreq: f.curlFreq,
            curlTime: this._time * f.curlTimeScale,
            attractorStrength: f.attractorStrength,
            attractor: f.attractor,
            wrapCenter: this.wrap.center,
            wrapSize: this.wrap.size,
            emitPosition: e.position,
            emitRadius: e.radius,
            emitBox: e.box,
            emitSpread: e.spread,
            emitDirection: e.direction,
            speedRange: e.speed,
            lifeRange: e.life,
            separation: b.separation,
            alignment: b.alignment,
            cohesion: b.cohesion,
            neighborRadius: b.neighborRadius,
            maxSpeed: b.maxSpeed,
            maxForce: b.maxForce,
            gridCellSize: cellSize,
            gridOrigin: [b.center[0] - half, b.center[1] - half, b.center[2] - half],
        });
        this.gpu.device.queue.writeBuffer(this._simUniformBuffer, 0, this._simUniforms.arrayBuffer);
    }

    /**
     * Run one sim step. Call every frame BEFORE renderer.render().
     * @param {GPUCommandEncoder} [encoder] chain into an existing encoder; when
     *   null the system creates and submits its own.
     * @param {object} opts
     * @param {number} opts.dt frame delta time in seconds
     */
    update(encoder = null, { dt = 1 / 60 } = {}) {
        const parity = this._frame % 2;
        this._time += dt;

        // fractional emission accumulator — rate is particles/second
        this._emitAccum += this.emitter.rate * this.emissionScale * dt;
        let requested = Math.floor(this._emitAccum);
        this._emitAccum -= requested;
        requested = Math.min(requested + this._pendingBurst, this.capacity);
        this._pendingBurst = 0;

        this._writeSimUniforms(dt, requested);

        const ownEncoder = !encoder;
        const enc = encoder ?? this.gpu.device.createCommandEncoder({ label: `${this.label}-update` });
        const pass = enc.beginComputePass({ label: `${this.label}-sim-pass` });
        const cs = this._compute;

        cs.dispatch(enc, { pass, kernel: cs.findKernel('beginFrame'), bindGroup: this._bg.beginFrame, dispatchCount: [1, 1, 1] });
        if (requested > 0) {
            cs.dispatch(enc, { pass, kernel: cs.findKernel('emit'), bindGroup: this._bg.emit[parity], dispatchCount: [Math.ceil(requested / WORKGROUP), 1, 1] });
        }
        cs.dispatch(enc, { pass, kernel: cs.findKernel('writeSimArgs'), bindGroup: this._bg.writeSimArgs, dispatchCount: [1, 1, 1] });

        if (this.mode === 'boids') {
            cs.dispatch(enc, { pass, kernel: cs.findKernel('gridClear'), bindGroup: this._bg.gridClear, dispatchCount: [NUM_CELLS / WORKGROUP, 1, 1] });
            cs.dispatch(enc, { pass, kernel: cs.findKernel('gridBuild'), bindGroup: this._bg.gridBuild[parity], dispatchCount: [1, 1, 1], workgroupBuffer: this._simDispatchBuffer });
            cs.dispatch(enc, { pass, kernel: cs.findKernel('simulateBoids'), bindGroup: this._bg.simulateBoids[parity], dispatchCount: [1, 1, 1], workgroupBuffer: this._simDispatchBuffer });
        } else {
            cs.dispatch(enc, { pass, kernel: cs.findKernel('simulate'), bindGroup: this._bg.simulate[parity], dispatchCount: [1, 1, 1], workgroupBuffer: this._simDispatchBuffer });
        }

        pass.end();

        // opt-in counter readback — own-encoder frames only, so mapAsync
        // always follows the submit that contains the copy
        const debugThisFrame = this.debugCounters && ownEncoder && !this._debugPending && this._frame % 30 === 0;
        if (debugThisFrame) enc.copyBufferToBuffer(this._countersBuffer, 0, this._debugStaging, 0, 16);

        if (ownEncoder) this.gpu.device.queue.submit([enc.finish()]);
        if (debugThisFrame) this._readDebugCounters();

        // point the render pass at this frame's compacted out-list
        this.bindGroups[0] = this._renderBGs[parity];
        this._frame++;
    }

    _readDebugCounters() {
        this._debugPending = true;
        this._debugStaging
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const [dead, aliveIn, aliveOut, realEmit] = new Uint32Array(this._debugStaging.getMappedRange());
                this._debugStaging.unmap();
                this._debugPending = false;
                console.log(`[${this.label}] dead ${dead} | alive-in ${aliveIn} | alive-out ${aliveOut} | emitted ${realEmit}`);
            })
            .catch(() => {
                this._debugPending = false;
            });
    }

    /** Kill every particle and refill the dead list. Re-queues the preset burst. */
    reset() {
        const enc = this.gpu.device.createCommandEncoder({ label: `${this.label}-reset` });
        this._compute.dispatch(enc, {
            kernel: this._compute.findKernel('reset'),
            bindGroup: this._bg.reset,
            dispatchCount: [Math.ceil(this.capacity / WORKGROUP), 1, 1],
        });
        this.gpu.device.queue.submit([enc.finish()]);
        this._emitAccum = 0;
        this._pendingBurst = this.emitter.burst || 0;
    }

    /** Swap to another PARTICLE_PRESETS entry at runtime. */
    setPreset(name) {
        if (!PARTICLE_PRESETS[name]) {
            console.warn(`[ParticleSystem] unknown preset '${name}'`);
            return;
        }
        this.preset = name;
        const config = resolveConfig({ preset: name });
        this.mode = config.mode;
        // mutate in place so GUI bindings stay live
        Object.assign(this.emitter, config.emitter);
        Object.assign(this.forces, config.forces);
        Object.assign(this.boids, config.boids);
        Object.assign(this.appearance, config.appearance);
        this.setBlending(config.appearance.blending);
        this._applyAppearance();
        this.reset();
        this._gui?.pane.refresh();
    }

    /** 'additive' | 'premultiplied' — swaps between the two prebuilt pipelines. */
    setBlending(mode) {
        const next = this._pipelines[mode];
        if (!next || next === this.pipeline) return;
        this.appearance.blending = mode;
        // same shader, so bind groups and uniform layout stay valid
        this.pipeline = next;
    }

    /** PerformanceProfile hook: scales emission rate per quality tier. */
    setQuality(tier) {
        this.emissionScale = QUALITY_EMISSION[tier] ?? 1;
    }

    addGUI(gui) {
        const folder = gui.folder('particle-system');
        this._gui = folder;

        const proxy = { preset: this.preset ?? Object.keys(PARTICLE_PRESETS)[0] };
        const options = Object.fromEntries(Object.keys(PARTICLE_PRESETS).map((k) => [k, k]));
        folder.add(proxy, 'preset', { options }).on('change', (ev) => this.setPreset(ev.value));

        const emitter = folder.folder('emitter', { expanded: false });
        emitter.add(this.emitter, 'rate', { min: 0, max: 50000, step: 10 });
        emitter.add(this.emitter, 'radius', { min: 0, max: 5, step: 0.01 });
        emitter.add(this.emitter, 'spread', { min: 0, max: 1, step: 0.01 });

        const forces = folder.folder('forces', { expanded: false });
        forces.add(this.forces, 'drag', { min: 0, max: 5, step: 0.01 });
        forces.add(this.forces, 'curlAmp', { min: 0, max: 5, step: 0.01 });
        forces.add(this.forces, 'curlFreq', { min: 0, max: 3, step: 0.01 });
        forces.add(this.forces, 'attractorStrength', { min: -5, max: 5, step: 0.01 });

        const appearance = folder.folder('appearance', { expanded: false });
        appearance.uniform(this, 'uSize', { label: 'size', min: 0.001, max: 0.2, step: 0.001 });
        appearance.uniform(this, 'uStretch', { label: 'stretch', min: 0, max: 1, step: 0.01 });
        appearance.uniform(this, 'uOpacity', { label: 'opacity', min: 0, max: 1, step: 0.01 });
        appearance.uniform(this, 'uSoftness', { label: 'softness', min: 0, max: 1, step: 0.01 });

        const boids = folder.folder('boids', { expanded: false });
        boids.add(this.boids, 'separation', { min: 0, max: 2, step: 0.01 });
        boids.add(this.boids, 'alignment', { min: 0, max: 4, step: 0.01 });
        boids.add(this.boids, 'cohesion', { min: 0, max: 4, step: 0.01 });
        boids.add(this.boids, 'neighborRadius', { min: 0.05, max: 2, step: 0.01 });
        boids.add(this.boids, 'maxSpeed', { min: 0.1, max: 10, step: 0.1 });
        boids.add(this.boids, 'maxForce', { min: 0.1, max: 20, step: 0.1 });

        folder.button('reset', () => this.reset());

        if (import.meta.env?.DEV) {
            folder.add(this, 'debugCounters', { label: 'debug-counters' });
        }

        return folder;
    }

    dispose() {
        this._compute._unregister?.();
        for (const p of Object.values(this._pipelines)) p.destroy();
        this.geometry.destroy();
        for (const buf of [this._particleBuffer, this._countersBuffer, this._deadListBuffer, ...this._aliveBuffers, this._drawBuffer, this._simDispatchBuffer, this._gridCountsBuffer, this._gridIndicesBuffer, this._simUniformBuffer, this._debugStaging]) {
            buf.destroy();
        }
    }
}
