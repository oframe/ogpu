// Rain: thin composition over ParticleSystem (velocity-stretched streaks in a
// camera-following wrap volume) + RippleField (analytic impact ripples baked
// into a tileable texture for ground shaders to consume — see ./CLAUDE.md for
// the consumer snippet). Call `update(encoder, { dt, camera })` every frame
// BEFORE renderer.render().

import { Transform } from '@core/Transform';
import { ComputeShader } from '@core/ComputeShader';
import { createStorageBuffer, createUniformBuffer } from '@utils/BufferUtils';
import { makeStructuredView } from 'webgpu-utils';

import { ParticleSystem } from '../particles/ParticleSystem.js';
import ripplesCode from './ripples.wgsl?raw';

// steady-state streak count ≈ rate * life (rate = count / life)
export const RAIN_PRESETS = {
    drizzle: { count: 4000, life: 8, fallSpeed: 5, stretch: 2.0, size: 0.012, gust: 0.2, wind: [0.1, 0, 0.05], opacity: 0.25, rippleRate: 40 },
    light: { count: 10000, life: 8, fallSpeed: 7, stretch: 2.2, size: 0.014, gust: 0.5, wind: [0.2, 0, 0.1], opacity: 0.3, rippleRate: 100 },
    heavy: { count: 22000, life: 7, fallSpeed: 10, stretch: 2.4, size: 0.016, gust: 1.0, wind: [0.4, 0, 0.2], opacity: 0.35, rippleRate: 220 },
    storm: { count: 35000, life: 6, fallSpeed: 13, stretch: 2.6, size: 0.018, gust: 2.5, wind: [1.2, 0, 0.5], opacity: 0.4, rippleRate: 400 },
    downpour: { count: 50000, life: 6, fallSpeed: 16, stretch: 2.8, size: 0.02, gust: 1.5, wind: [0.6, 0, 0.3], opacity: 0.5, rippleRate: 600 },
};

const MAX_SPAWN_PER_FRAME = 32;

// 512² rgba16float tile: xy = height gradient (normal perturbation), z = height.
// Ring buffer of impact events; both kernels live in ripples.wgsl.
export class RippleField {
    constructor(gpu, { resolution = 512, worldSize = 20, maxRipples = 256, label = 'ripple-field' } = {}) {
        this.gpu = gpu;
        this.worldSize = worldSize;
        this.resolution = resolution;
        this.rate = 100; // impacts/sec across the tile, driven by rain intensity
        this.params = { speed: 1.6, damping: 1.6, amplitude: 1.0, ringWidth: 0.14, maxAge: 3 };

        const { device } = gpu;

        this.texture = device.createTexture({
            label: `${label}-texture`,
            size: [resolution, resolution],
            format: 'rgba16float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.view = this.texture.createView();

        this._rippleBuffer = createStorageBuffer(gpu, {
            label: `${label}-ring`,
            size: maxRipples * 16,
        });
        this._headBuffer = createStorageBuffer(gpu, {
            label: `${label}-head`,
            size: 4,
        });

        this._compute = new ComputeShader(gpu, { label, code: ripplesCode });
        this._uniforms = makeStructuredView(this._compute.defs.uniforms.rippleUniforms);
        this._uniformBuffer = createUniformBuffer(gpu, {
            label: `${label}-uniforms`,
            size: this._uniforms.arrayBuffer.byteLength,
        });

        this._spawnBG = device.createBindGroup({
            label: `${label}-spawn-bg`,
            layout: this._compute.bindGroupLayout('rippleSpawn'),
            entries: [
                { binding: 0, resource: { buffer: this._uniformBuffer } },
                { binding: 1, resource: { buffer: this._rippleBuffer } },
                { binding: 2, resource: { buffer: this._headBuffer } },
            ],
        });
        this._evalBG = device.createBindGroup({
            label: `${label}-eval-bg`,
            layout: this._compute.bindGroupLayout('rippleEval'),
            entries: [
                { binding: 0, resource: { buffer: this._uniformBuffer } },
                { binding: 1, resource: { buffer: this._rippleBuffer } },
                { binding: 3, resource: this.view },
            ],
        });

        this._time = 0;
        this._accum = 0;
    }

    update(encoder, { dt = 1 / 60 } = {}) {
        this._time += dt;
        this._accum += this.rate * dt;
        const spawnCount = Math.min(Math.floor(this._accum), MAX_SPAWN_PER_FRAME);
        this._accum -= spawnCount;

        const p = this.params;
        this._uniforms.set({
            time: this._time,
            spawnCount,
            worldSize: this.worldSize,
            seed: Math.random() * 100,
            speed: p.speed,
            damping: p.damping,
            amplitude: p.amplitude,
            ringWidth: p.ringWidth,
            maxAge: p.maxAge,
        });
        this.gpu.device.queue.writeBuffer(this._uniformBuffer, 0, this._uniforms.arrayBuffer);

        const cs = this._compute;
        const pass = encoder.beginComputePass({ label: 'ripple-pass' });
        if (spawnCount > 0) {
            cs.dispatch(encoder, { pass, kernel: cs.findKernel('rippleSpawn'), bindGroup: this._spawnBG, dispatchCount: [1, 1, 1] });
        }
        const groups = Math.ceil(this.resolution / 8);
        cs.dispatch(encoder, { pass, kernel: cs.findKernel('rippleEval'), bindGroup: this._evalBG, dispatchCount: [groups, groups, 1] });
        pass.end();
    }

    dispose() {
        this._compute._unregister?.();
        this.texture.destroy();
        this._rippleBuffer.destroy();
        this._headBuffer.destroy();
        this._uniformBuffer.destroy();
    }
}

export class RainSystem extends Transform {
    /**
     * @param {object} gpu - renderer.gpu context
     * @param {object} options
     * @param {string} [options.preset='light'] key of RAIN_PRESETS
     * @param {number} [options.capacity=60000] particle pool size
     * @param {number} [options.area=14] wrap volume footprint (x/z, world units)
     * @param {number} [options.height=10] wrap volume height
     * @param {object} [options.ripple] RippleField options { resolution, worldSize, maxRipples }
     * @param {string} [options.label]
     */
    constructor(gpu, { preset = 'light', capacity = 60_000, area = 14, height = 10, ripple = {}, label = 'rain' } = {}) {
        super();
        if (!gpu) throw new Error('RainSystem: no webgpu context provided');
        if (!RAIN_PRESETS[preset]) preset = 'light';

        this.gpu = gpu;
        this.label = label;
        this.preset = preset;
        this.intensity = 1;
        this.qualityScale = 1;
        this.area = area;
        this.height = height;
        this._time = 0;

        const p = RAIN_PRESETS[preset];

        this.system = new ParticleSystem(gpu, {
            capacity,
            label: `${label}-particles`,
            mode: 'sim',
            emitter: {
                rate: p.count / p.life,
                position: [0, 0, 0],
                box: [area / 2, height / 2, area / 2],
                direction: [0, -1, 0],
                spread: 0.02,
                speed: [p.fallSpeed * 0.85, p.fallSpeed * 1.15],
                life: [p.life * 0.7, p.life * 1.3],
            },
            forces: {
                gravity: [0, -0.5, 0],
                wind: [...p.wind],
                drag: 0,
                curlAmp: 0,
            },
            appearance: {
                size: p.size,
                blending: 'premultiplied',
                billboard: 'stretched',
                stretch: p.stretch,
                opacity: p.opacity,
                softness: 0.6,
                sizeKnots: [1, 1, 1, 1],
                alphaKnots: [0, 1, 1, 1],
                colors: [
                    [0.7, 0.78, 0.9],
                    [0.7, 0.78, 0.9],
                    [0.7, 0.78, 0.9],
                    [0.7, 0.78, 0.9],
                ],
            },
            wrap: {
                enabled: true,
                center: [0, 0, 0],
                size: [area, height, area],
            },
        });
        this.addChild(this.system);

        this.ripples = new RippleField(gpu, { label: `${label}-ripples`, ...ripple });
        this.ripples.rate = p.rippleRate;

        // ground-shader consumption surface
        this.tRipple = this.ripples.view;
        this.rippleWorldSize = this.ripples.worldSize;
    }

    /**
     * Run rain + ripple sim. Call every frame BEFORE renderer.render().
     * @param {GPUCommandEncoder} [encoder] optional external encoder
     * @param {object} opts { dt, camera } — camera drives the wrap volume follow
     */
    update(encoder = null, { dt = 1 / 60, camera = null } = {}) {
        this._time += dt;
        const preset = RAIN_PRESETS[this.preset];

        if (camera) {
            const c = camera.worldPosition;
            const center = [c[0], c[1] + this.height * 0.2, c[2]];
            this.system.wrap.center = center;
            this.system.emitter.position = center;
        }

        // gusting: slow sinusoid mix on top of the base wind
        const gust = preset.gust * (0.6 * Math.sin(this._time * 0.7) + 0.4 * Math.sin(this._time * 1.9));
        this.system.forces.wind = [preset.wind[0] + gust, preset.wind[1], preset.wind[2] + gust * 0.35];

        this.system.emissionScale = this.intensity * this.qualityScale;
        this.ripples.rate = preset.rippleRate * this.intensity * this.qualityScale;

        const ownEncoder = !encoder;
        const enc = encoder ?? this.gpu.device.createCommandEncoder({ label: `${this.label}-update` });
        this.system.update(enc, { dt });
        this.ripples.update(enc, { dt });
        if (ownEncoder) this.gpu.device.queue.submit([enc.finish()]);
    }

    setPreset(name) {
        const p = RAIN_PRESETS[name];
        if (!p) {
            console.warn(`[RainSystem] unknown preset '${name}'`);
            return;
        }
        this.preset = name;
        const e = this.system.emitter;
        e.rate = p.count / p.life;
        e.speed = [p.fallSpeed * 0.85, p.fallSpeed * 1.15];
        e.life = [p.life * 0.7, p.life * 1.3];
        this.system.forces.wind = [...p.wind];
        Object.assign(this.system.appearance, { size: p.size, stretch: p.stretch, opacity: p.opacity });
        this.system.uniforms.set({ uSize: p.size, uStretch: p.stretch, uOpacity: p.opacity });
        this.ripples.rate = p.rippleRate;
        // no reset: existing streaks age out, density converges over ~life seconds
    }

    /** PerformanceProfile hook: scales rain + ripple density per tier. */
    setQuality(tier) {
        this.qualityScale = { low: 0.2, medium: 0.6, high: 1, ultra: 1 }[tier] ?? 1;
    }

    addGUI(gui) {
        const folder = gui.folder('rain');

        const proxy = { preset: this.preset };
        const options = Object.fromEntries(Object.keys(RAIN_PRESETS).map((k) => [k, k]));
        folder.add(proxy, 'preset', { options }).on('change', (ev) => this.setPreset(ev.value));
        folder.add(this, 'intensity', { min: 0, max: 1, step: 0.01 });

        const ripples = folder.folder('ripples', { expanded: false });
        ripples.add(this.ripples.params, 'amplitude', { min: 0, max: 3, step: 0.01 });
        ripples.add(this.ripples.params, 'speed', { min: 0.2, max: 5, step: 0.01 });
        ripples.add(this.ripples.params, 'damping', { min: 0.2, max: 5, step: 0.01 });
        ripples.add(this.ripples.params, 'ringWidth', { min: 0.02, max: 0.5, step: 0.005 });

        if (import.meta.env?.DEV) {
            folder.add(this.system, 'debugCounters', { label: 'debug-counters' });
        }

        return folder;
    }

    dispose() {
        this.system.dispose();
        this.ripples.dispose();
    }
}
