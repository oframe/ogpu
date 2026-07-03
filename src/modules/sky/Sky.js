import { makeStructuredView, generateMipmap } from 'webgpu-utils';
import { ComputeShader } from '@core/ComputeShader';
import { RenderPipeline } from '@core/RenderPipeline';
import { Mesh } from '@core/Mesh';
import { FullscreenTriangle } from '@core/primitives/FullscreenTriangle';
import { createUniformBuffer, createStorageBuffer } from '@utils/BufferUtils';
import { createDynamicIBL } from '@utils/IBLUtils/IBLUtils';
import { Vec3 } from '@math';
import { SKY_PRESETS } from './presets.js';

import transmittanceShader from './transmittance_lut.wgsl?raw';
import skyviewShader from './skyview_lut.wgsl?raw';
import shProjectShader from './sh_project.wgsl?raw';
import skyShader from './sky.wgsl?raw';

const TRANS_W = 256;
const TRANS_H = 64;
const SKYVIEW_W = 192;
const SKYVIEW_H = 108;

// km units — must match the WGSL constants
const GROUND_R = 6360;
const TOP_R = 6460;
const RAYLEIGH = [5.802e-3, 13.558e-3, 33.1e-3];
const MIE_SCATTER = 3.996e-3;
const MIE_ABSORB = 4.4e-3;
const OZONE = [0.65e-3, 1.881e-3, 0.085e-3];

const RAD = Math.PI / 180;

const smooth01 = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const mix3 = (out, a, b, c, wa, wb, wc) => {
    for (let i = 0; i < 3; i++) out[i] = a[i] * wa + b[i] * wb + c[i] * wc;
    return out;
};

/**
 * Dynamic sky + sun. Time-of-day driven sun position, physical (Hillaire 2020
 * LUT subset) or artistic (gradient stops) radiance — selected per-frame by
 * uniform, no pipeline permutation — with a grading layer applied in both
 * modes, and an optional amortized dynamic IBL (prefiltered specular cube +
 * runtime SH irradiance) that PBR meshes bind directly.
 *
 * Construct after `await renderer.ready`. Add `sky.mesh` to the scene for the
 * background; call `sky.update({ deltaTime })` once per frame BEFORE rendering.
 * With a post composer pass it as `post` so the background pipeline matches the
 * MRT + depth32float scene target; without it the plain swapchain path is used
 * (filmic + gamma applied in-shader).
 *
 * Consumers: `sky.sunDirection` / `sky.sunColor` (directional light + shadows),
 * `sky.ibl.prefiltered` (tSpecular; feed `.mipLevels` back as the
 * `roughnessLevels` override), `sky.ibl.shBuffer` (shConstants uniform block).
 */
export class Sky {
    constructor(
        gpu,
        {
            post = null,
            ibl = {},
            preset = 'physical',
            timeOfDay = 10,
            timeScale = 0,
            latitude = 45,
            dayOfYear = 172,
            viewHeight = 0.2,
            sunDiskSize = 1.2,
            sunDiskSoftness = 0.15,
            sunDiskIntensity = 100,
            exposure = 1,
            label = 'sky',
        } = {}
    ) {
        if (!gpu) {
            console.error('no webgpu context provided');
            return;
        }

        this.gpu = gpu;
        this.post = post;
        this.label = label;

        this.timeOfDay = timeOfDay;
        this.timeScale = timeScale;
        this.latitude = latitude;
        this.dayOfYear = dayOfYear;
        this.viewHeight = viewHeight;
        this.sunDiskSize = sunDiskSize;
        this.sunDiskSoftness = sunDiskSoftness;
        this.sunDiskIntensity = sunDiskIntensity;
        this.exposure = exposure;

        this.sunDirection = new Vec3(0, 1, 0);
        this.sunColor = new Vec3();
        this.sunElevation = -10;
        this.sunAzimuth = 0;
        this._diskRadiance = [0, 0, 0];

        this.iblBudget = ibl?.budget ?? 6;
        this.iblInterval = ibl?.interval ?? 1;

        this._atmosphereDirty = true;
        this._skyDirty = true;
        this._facesStale = true;
        this._mipsStale = false;
        this._envPending = 0;
        this._frame = 0;

        this.setPreset(preset);

        this._initLUTs();
        this._initBackground();
        if (ibl !== false) this._initIBL(ibl || {});

        this._computeSun();
        this.refreshEnvironment();
        this._writeMeshUniforms();
    }

    setPreset(name) {
        const preset = SKY_PRESETS[name];
        if (!preset) {
            console.warn(`[sky] unknown preset '${name}'`);
            return;
        }
        this.preset = name;
        // deep copy — GUI edits mutate params without touching the preset table
        this.params = JSON.parse(
            JSON.stringify({
                mode: preset.mode,
                turbidity: preset.turbidity,
                sunIntensity: preset.sunIntensity,
                multiScatter: preset.multiScatter,
                grade: preset.grade,
                palette: preset.palette,
            })
        );
        this._atmosphereDirty = true;
        this._skyDirty = true;
    }

    // ---- per-frame ----

    update({ deltaTime = 0 } = {}) {
        this._frame++;

        if (this.timeScale > 0 && deltaTime > 0) {
            this.timeOfDay = (this.timeOfDay + (deltaTime * this.timeScale) / 3600 + 24) % 24;
            this._skyDirty = true;
        }
        if (this._computeSun()) this._skyDirty = true;

        const envDue = this.ibl && (this._envPending > 0 || this._skyDirty) && this._frame % this.iblInterval === 0;

        if (this._atmosphereDirty || this._skyDirty || envDue) {
            if (this._atmosphereDirty) this._writeTransmittanceUniforms();
            if (this._skyDirty) this._writeSkyUniforms();

            const { device } = this.gpu;
            const encoder = device.createCommandEncoder({ label: `${this.label}-lut-encoder` });

            if (this._atmosphereDirty) this._dispatchTransmittance(encoder);
            if (this._skyDirty) {
                this._dispatchSkyview(encoder);
                if (this.ibl) {
                    this._envPending = this.ibl.sliceCount;
                    this._facesStale = true;
                }
            }
            if (envDue && this._facesStale) {
                this._dispatchCubeFaces(encoder);
                this._facesStale = false;
                this._mipsStale = true;
            }
            device.queue.submit([encoder.finish()]);

            if (envDue) this._runIBL({ budget: this.iblBudget });

            this._atmosphereDirty = false;
            this._skyDirty = false;
        }

        this._writeMeshUniforms();
    }

    // Full-burst refresh: LUTs, all six faces, mips, every prefilter slice and
    // the SH projection in one go. Used at boot and after a time scrub ends.
    refreshEnvironment() {
        this._writeTransmittanceUniforms();
        this._writeSkyUniforms();

        const { device } = this.gpu;
        const encoder = device.createCommandEncoder({ label: `${this.label}-refresh-encoder` });
        this._dispatchTransmittance(encoder);
        this._dispatchSkyview(encoder);
        if (this.ibl) {
            this._dispatchCubeFaces(encoder);
            this._mipsStale = true;
        }
        device.queue.submit([encoder.finish()]);

        if (this.ibl) this._runIBL({ full: true });

        this._atmosphereDirty = false;
        this._skyDirty = false;
        this._facesStale = false;
        this._envPending = 0;
        this._writeMeshUniforms();
    }

    // ---- GPU dispatch helpers ----

    _dispatchTransmittance(encoder) {
        this.transCompute.dispatch(encoder, {
            kernel: this.transCompute.kernels.main,
            bindGroup: this.transBindGroup,
            dispatchCount: [Math.ceil(TRANS_W / 8), Math.ceil(TRANS_H / 8), 1],
        });
    }

    _dispatchSkyview(encoder) {
        this.skyCompute.dispatch(encoder, {
            kernel: this.skyCompute.kernels.main,
            bindGroup: this.skyBindGroup,
            dispatchCount: [Math.ceil(SKYVIEW_W / 8), Math.ceil(SKYVIEW_H / 8), 1],
        });
    }

    _dispatchCubeFaces(encoder) {
        const size = Math.ceil(this.ibl.prefiltered.faceSize / 8);
        for (let f = 0; f < 6; f++) {
            this.skyCompute.dispatch(encoder, {
                kernel: this.skyCompute.kernels.cubeFaces,
                bindGroup: this.faceBindGroups[f],
                dispatchCount: [size, size, 1],
            });
        }
    }

    // Source mips (prefilter input pyramid), then GGX slices + SH projection.
    _runIBL({ budget = 6, full = false } = {}) {
        const { device } = this.gpu;

        if (this._mipsStale) {
            generateMipmap(device, this.ibl.sourceCube);
            this._mipsStale = false;
        }

        const encoder = device.createCommandEncoder({ label: `${this.label}-ibl-encoder` });
        if (full) {
            this.ibl.refresh(encoder);
        } else {
            const done = this.ibl.update(encoder, { budget });
            this._envPending = Math.max(0, this._envPending - done);
        }
        this.shCompute.dispatch(encoder, {
            kernel: this.shCompute.kernels.main,
            bindGroup: this.shBindGroup,
            dispatchCount: [1, 1, 1],
        });
        encoder.copyBufferToBuffer(this.shStorage, 0, this.ibl.shBuffer, 0, 9 * 16);
        device.queue.submit([encoder.finish()]);
    }

    // ---- init ----

    _initLUTs() {
        const { device } = this.gpu;
        const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

        this.transmittanceTexture = device.createTexture({
            label: `${this.label}-transmittance-lut`,
            size: [TRANS_W, TRANS_H],
            format: 'rgba16float',
            usage,
        });
        this.skyviewTexture = device.createTexture({
            label: `${this.label}-skyview-lut`,
            size: [SKYVIEW_W, SKYVIEW_H],
            format: 'rgba16float',
            usage,
        });
        this.transmittanceView = this.transmittanceTexture.createView();
        this.skyviewView = this.skyviewTexture.createView();

        this.lutSampler = device.createSampler({
            label: `${this.label}-lut-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.transCompute = new ComputeShader(this.gpu, { label: `${this.label}-transmittance`, code: transmittanceShader });
        this.transUniforms = makeStructuredView(this.transCompute.defs.uniforms.uniforms);
        this.transBuffer = createUniformBuffer(this.gpu, {
            label: `${this.label}-transmittance-uniforms`,
            size: this.transUniforms.arrayBuffer.byteLength,
        });
        this.transBindGroup = device.createBindGroup({
            label: `${this.label}-transmittance-bg`,
            layout: this.transCompute.bindGroupLayout('main'),
            entries: [
                { binding: 0, resource: { buffer: this.transBuffer } },
                { binding: 1, resource: this.transmittanceView },
            ],
        });

        this.skyCompute = new ComputeShader(this.gpu, { label: `${this.label}-skyview`, code: skyviewShader });
        this.skyUniforms = makeStructuredView(this.skyCompute.defs.uniforms.uniforms);
        this.skyBuffer = createUniformBuffer(this.gpu, {
            label: `${this.label}-skyview-uniforms`,
            size: this.skyUniforms.arrayBuffer.byteLength,
        });
        this.skyBindGroup = device.createBindGroup({
            label: `${this.label}-skyview-bg`,
            layout: this.skyCompute.bindGroupLayout('main'),
            entries: [
                { binding: 0, resource: { buffer: this.skyBuffer } },
                { binding: 1, resource: this.transmittanceView },
                { binding: 2, resource: this.skyviewView },
                { binding: 3, resource: this.lutSampler },
            ],
        });
    }

    _initBackground() {
        const { device } = this.gpu;
        const post = this.post;

        this.geometry = new FullscreenTriangle(this.gpu);

        // plain swapchain path: strip the MRT normal output (single color target)
        const code = post
            ? skyShader
            : skyShader
                  .split('\n')
                  .filter((l) => !l.trimEnd().endsWith('// mrt'))
                  .join('\n');

        this.pipeline = new RenderPipeline(this.gpu, {
            label: `${this.label}-background-pipeline`,
            code,
            vertexBuffers: this.geometry.bufferLayouts,
            targets: post ? post.sceneTarget.getTargets() : undefined,
            // far-plane draw: pass only where depth is still at the clear value
            depthStencil: post ? { ...post.depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' } : { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
            cullMode: 'none',
        });

        this.mesh = new Mesh(this.gpu, {
            label: `${this.label}-background`,
            pipeline: this.pipeline,
            geometry: this.geometry,
            frustumCulled: false,
            // after the other opaques: sky only fills untouched pixels (early-z)
            renderOrder: 1000,
            bindGroups: (uniformBuffer) => [
                device.createBindGroup({
                    label: `${this.label}-background-bg`,
                    layout: this.pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: this.skyviewView },
                        { binding: 2, resource: this.lutSampler },
                    ],
                }),
            ],
        });
    }

    _initIBL({ faceSize = 128, mipLevels = null, samples = 256 } = {}) {
        const { device } = this.gpu;

        this.ibl = createDynamicIBL(this.gpu, { faceSize, mipLevels, samples, label: `${this.label}-ibl` });

        const faceDefs = makeStructuredView(this.skyCompute.defs.uniforms.face);
        const faceLayout = this.skyCompute.bindGroupLayout('cubeFaces');
        this.faceBindGroups = [];
        for (let f = 0; f < 6; f++) {
            faceDefs.set({ index: f });
            const buf = createUniformBuffer(this.gpu, {
                label: `${this.label}-face-uniforms-${f}`,
                size: faceDefs.arrayBuffer.byteLength,
            });
            device.queue.writeBuffer(buf, 0, faceDefs.arrayBuffer);

            this.faceBindGroups.push(
                device.createBindGroup({
                    label: `${this.label}-face-bg-${f}`,
                    layout: faceLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.skyBuffer } },
                        { binding: 3, resource: this.lutSampler },
                        { binding: 4, resource: this.skyviewView },
                        {
                            binding: 5,
                            resource: this.ibl.sourceCube.createView({
                                dimension: '2d',
                                baseArrayLayer: f,
                                arrayLayerCount: 1,
                                baseMipLevel: 0,
                                mipLevelCount: 1,
                            }),
                        },
                        { binding: 6, resource: { buffer: buf } },
                    ],
                })
            );
        }

        // SH projection reads a ≤64² mip of the source pyramid
        this.shCompute = new ComputeShader(this.gpu, { label: `${this.label}-sh-project`, code: shProjectShader });
        const shMip = Math.max(0, Math.round(Math.log2(faceSize / 64)));
        const shParams = makeStructuredView(this.shCompute.defs.uniforms.uniforms);
        shParams.set({ srcMip: shMip, srcSize: faceSize >> shMip });
        this.shParamsBuffer = createUniformBuffer(this.gpu, {
            label: `${this.label}-sh-uniforms`,
            size: shParams.arrayBuffer.byteLength,
        });
        device.queue.writeBuffer(this.shParamsBuffer, 0, shParams.arrayBuffer);

        this.shStorage = createStorageBuffer(this.gpu, { label: `${this.label}-sh-storage`, size: 9 * 16 });
        this.shBindGroup = device.createBindGroup({
            label: `${this.label}-sh-bg`,
            layout: this.shCompute.bindGroupLayout('main'),
            entries: [
                { binding: 0, resource: { buffer: this.shParamsBuffer } },
                { binding: 1, resource: this.ibl.sourceCube.createView({ dimension: '2d-array' }) },
                { binding: 2, resource: { buffer: this.shStorage } },
            ],
        });
    }

    // ---- sun ----

    // Time-of-day + latitude + declination -> elevation/azimuth/direction.
    // Azimuth 0 points at +Z (the noon sun for northern latitudes).
    _computeSun() {
        const decl = 0.4093 * Math.sin((2 * Math.PI * (this.dayOfYear - 81)) / 365);
        const h = (this.timeOfDay - 12) * 15 * RAD;
        const lat = this.latitude * RAD;

        const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
        const el = Math.asin(Math.min(1, Math.max(-1, sinEl)));
        const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));

        const changed = Math.abs(el - this.sunElevation) > 1e-6 || Math.abs(az - this.sunAzimuth) > 1e-6;
        this.sunElevation = el;
        this.sunAzimuth = az;
        this.sunDirection.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
        return changed;
    }

    // CPU transmittance march along the sun ray — cheap closed-form-ish source
    // for sun disk/directional color, consistent with the GPU coefficients.
    _transmittanceCPU(el) {
        const mieScale = this.params.turbidity / 2.5;
        const r0 = GROUND_R + this.viewHeight;
        const mu = Math.sin(el);
        const cosEl = Math.cos(el);

        const b = r0 * mu;
        const discG = b * b - (r0 * r0 - GROUND_R * GROUND_R);
        if (mu < 0 && discG > 0 && -b - Math.sqrt(discG) > 0) return [0, 0, 0];

        const tTop = -b + Math.sqrt(Math.max(b * b - (r0 * r0 - TOP_R * TOP_R), 0));
        const steps = 32;
        const dt = tTop / steps;
        const tau = [0, 0, 0];
        for (let i = 0; i < steps; i++) {
            const t = (i + 0.5) * dt;
            const px = cosEl * t;
            const py = r0 + mu * t;
            const hgt = Math.max(Math.hypot(px, py) - GROUND_R, 0);
            const dR = Math.exp(-hgt / 8);
            const dM = Math.exp(-hgt / 1.2);
            const dO = Math.max(0, 1 - Math.abs(hgt - 25) / 15);
            for (let c = 0; c < 3; c++) {
                tau[c] += (RAYLEIGH[c] * dR + (MIE_SCATTER + MIE_ABSORB) * mieScale * dM + OZONE[c] * dO) * dt;
            }
        }
        return tau.map((x) => Math.exp(-x));
    }

    // Blend the artistic palette keyframes by sun elevation (time-of-day curves).
    _blendPalette() {
        const pal = this.params.palette;
        const elDeg = this.sunElevation / RAD;
        const wDay = smooth01(3, 18, elDeg);
        const wNight = smooth01(5, 14, -elDeg);
        const wSunset = Math.max(0, 1 - wDay - wNight);

        const out = {};
        for (const key of ['zenith', 'horizon', 'ground', 'halo', 'sunDisk']) {
            out[key] = mix3([0, 0, 0], pal.day[key], pal.sunset[key], pal.night[key], wDay, wSunset, wNight);
        }
        for (const key of ['haloExponent', 'intensity', 'sunDiskIntensity']) {
            out[key] = pal.day[key] * wDay + pal.sunset[key] * wSunset + pal.night[key] * wNight;
        }
        return out;
    }

    // ---- uniform uploads ----

    _writeTransmittanceUniforms() {
        const mieScale = this.params.turbidity / 2.5;
        this.transUniforms.set({
            rayleighScatter: RAYLEIGH,
            mieScatter: MIE_SCATTER * mieScale,
            ozoneAbsorb: OZONE,
            mieAbsorb: MIE_ABSORB * mieScale,
        });
        this.gpu.device.queue.writeBuffer(this.transBuffer, 0, this.transUniforms.arrayBuffer);
    }

    _writeSkyUniforms() {
        const p = this.params;
        const g = p.grade;
        const mieScale = p.turbidity / 2.5;
        const physical = p.mode === 'physical';
        const pal = this._blendPalette();

        const sinEl = Math.sin(this.sunElevation);
        const dayF = Math.min(1, Math.max(0.01, (sinEl + 0.15) / 1.15));
        const ms = p.multiScatter * 0.06 * p.sunIntensity * dayF;

        if (physical) {
            const trans = this._transmittanceCPU(this.sunElevation);
            this.sunColor.set(trans[0] * p.sunIntensity, trans[1] * p.sunIntensity, trans[2] * p.sunIntensity);
            this._diskRadiance = trans.map((t) => t * p.sunIntensity * this.sunDiskIntensity);
        } else {
            const s = p.sunIntensity * dayF;
            this.sunColor.set(pal.sunDisk[0] * s, pal.sunDisk[1] * s, pal.sunDisk[2] * s);
            this._diskRadiance = pal.sunDisk.map((c) => c * pal.sunDiskIntensity);
        }

        const stop = (rgb, scale, w = 1) => [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale, w];

        this.skyUniforms.set({
            rayleighScatter: RAYLEIGH,
            mieScatter: MIE_SCATTER * mieScale,
            ozoneAbsorb: OZONE,
            mieAbsorb: MIE_ABSORB * mieScale,
            msFactor: [0.8 * ms, 0.9 * ms, ms],
            sunIntensity: p.sunIntensity,
            groundAlbedo: [0.3, 0.3, 0.3],
            mieG: 0.8,
            sunElevation: this.sunElevation,
            sunAzimuth: this.sunAzimuth,
            viewHeight: this.viewHeight,
            mode: physical ? 0 : 1,
            zenithColor: stop(pal.zenith, pal.intensity),
            horizonColor: stop(pal.horizon, pal.intensity),
            groundColor: stop(pal.ground, pal.intensity),
            haloColor: stop(pal.halo, pal.intensity, pal.haloExponent),
            tintZenith: stop(g.tintZenith, 1),
            tintHorizon: stop(g.tintHorizon, 1),
            tintSunHalo: stop(g.tintSunHalo, 1),
            tintShadow: stop(g.tintShadow, 1, g.shadowAmount),
            gradeAmount: g.amount,
            saturation: g.saturation,
            contrast: g.contrast,
            sunDiskCos: Math.cos(this.sunDiskSize * RAD),
            sunColor: [...this._diskRadiance, 1],
            sunDiskSoftness: this.sunDiskSoftness,
        });
        this.gpu.device.queue.writeBuffer(this.skyBuffer, 0, this.skyUniforms.arrayBuffer);
    }

    _writeMeshUniforms() {
        this.mesh.uniforms.set({
            sunDirection: this.sunDirection,
            sunDiskCos: Math.cos(this.sunDiskSize * RAD),
            sunColor: this._diskRadiance,
            sunDiskSoftness: this.sunDiskSoftness,
            exposure: this.exposure,
            applyGamma: this.post ? 0 : 1,
        });
        // buffer upload happens in Mesh.draw
    }

    // ---- GUI ----

    addGUI(gui) {
        const dirty = () => {
            this._skyDirty = true;
        };
        const dirtyAtmosphere = () => {
            this._atmosphereDirty = true;
            this._skyDirty = true;
        };

        const f = gui.folder('sky');
        f.add(this, 'timeOfDay', { label: 'time-of-day', min: 0, max: 24, step: 0.01 }).on('change', (ev) => {
            this._skyDirty = true;
            if (ev.last) this.refreshEnvironment();
        });
        f.add(this, 'timeScale', { label: 'time-scale', min: 0, max: 86400, step: 1 });

        const modeProxy = { mode: this.params.mode };
        f.add(modeProxy, 'mode', { label: 'mode', options: { physical: 'physical', artistic: 'artistic' } }).on('change', (ev) => {
            this.params.mode = ev.value;
            dirty();
        });
        const presetProxy = { preset: this.preset };
        f.add(presetProxy, 'preset', {
            label: 'preset',
            options: Object.fromEntries(Object.keys(SKY_PRESETS).map((k) => [k, k])),
        }).on('change', (ev) => {
            this.setPreset(ev.value);
            modeProxy.mode = this.params.mode;
            gui.pane.refresh();
            this.refreshEnvironment();
        });

        f.add(this.params, 'turbidity', { label: 'turbidity', min: 1, max: 10, step: 0.1 }).on('change', dirtyAtmosphere);
        f.add(this.params, 'sunIntensity', { label: 'sun-intensity', min: 1, max: 60, step: 0.5 }).on('change', dirty);
        f.add(this, 'latitude', { label: 'latitude', min: -90, max: 90, step: 1 }).on('change', dirty);
        f.add(this, 'sunDiskSize', { label: 'sun-disk-size', min: 0.2, max: 8, step: 0.05 }).on('change', dirty);
        f.add(this, 'sunDiskSoftness', { label: 'sun-disk-softness', min: 0, max: 1, step: 0.01 }).on('change', dirty);
        f.add(this, 'sunDiskIntensity', { label: 'sun-disk-intensity', min: 0, max: 500, step: 1 }).on('change', dirty);
        f.add(this, 'exposure', { label: 'exposure', min: 0, max: 4, step: 0.01 });

        this._addGradeGUI(f);
        this._addPaletteGUI(f);
        if (this.ibl) this._addIBLGUI(f);
    }

    _addGradeGUI(parent) {
        const g = this.params.grade;
        const f = parent.folder('grading', { expanded: false });
        const dirty = () => {
            this._skyDirty = true;
        };

        for (const key of ['tintZenith', 'tintHorizon', 'tintSunHalo', 'tintShadow']) {
            const proxy = { [key]: { r: g[key][0], g: g[key][1], b: g[key][2] } };
            f.add(proxy, key, { label: key.replace('tint', 'tint-').toLowerCase(), color: { type: 'float' } }).on('change', (ev) => {
                const arr = this.params.grade[key];
                arr[0] = ev.value.r;
                arr[1] = ev.value.g;
                arr[2] = ev.value.b;
                dirty();
            });
        }
        f.add(g, 'shadowAmount', { label: 'shadow-amount', min: 0, max: 1, step: 0.01 }).on('change', dirty);
        f.add(g, 'saturation', { label: 'saturation', min: 0, max: 2, step: 0.01 }).on('change', dirty);
        f.add(g, 'contrast', { label: 'contrast', min: 0.5, max: 2, step: 0.01 }).on('change', dirty);
        f.add(g, 'amount', { label: 'amount', min: 0, max: 1, step: 0.01 }).on('change', dirty);
    }

    // Palette editor targets one keyframe at a time (day/sunset/night); the
    // runtime blend between keyframes stays driven by sun elevation.
    _addPaletteGUI(parent) {
        const f = parent.folder('palette', { expanded: false });
        const dirty = () => {
            this._skyDirty = true;
        };

        this._palKey = 'day';
        const proxy = { key: 'day', zenith: {}, horizon: {}, ground: {}, halo: {}, sunDisk: {}, intensity: 0, sunDiskIntensity: 0, haloExponent: 0 };
        const sync = () => {
            const k = this.params.palette[this._palKey];
            for (const c of ['zenith', 'horizon', 'ground', 'halo', 'sunDisk']) {
                proxy[c].r = k[c][0];
                proxy[c].g = k[c][1];
                proxy[c].b = k[c][2];
            }
            proxy.intensity = k.intensity;
            proxy.sunDiskIntensity = k.sunDiskIntensity;
            proxy.haloExponent = k.haloExponent;
        };
        sync();

        f.add(proxy, 'key', { label: 'edit-key', options: { day: 'day', sunset: 'sunset', night: 'night' } }).on('change', (ev) => {
            this._palKey = ev.value;
            sync();
            f.pane.refresh();
        });

        for (const c of ['zenith', 'horizon', 'ground', 'halo', 'sunDisk']) {
            f.add(proxy, c, { label: c.toLowerCase(), color: { type: 'float' } }).on('change', (ev) => {
                const arr = this.params.palette[this._palKey][c];
                arr[0] = ev.value.r;
                arr[1] = ev.value.g;
                arr[2] = ev.value.b;
                dirty();
            });
        }
        for (const [key, opts] of [
            ['intensity', { min: 0, max: 10, step: 0.05 }],
            ['sunDiskIntensity', { min: 0, max: 500, step: 1 }],
            ['haloExponent', { min: 1, max: 64, step: 0.5 }],
        ]) {
            f.add(proxy, key, { label: key.toLowerCase(), ...opts }).on('change', (ev) => {
                this.params.palette[this._palKey][key] = ev.value;
                dirty();
            });
        }
    }

    _addIBLGUI(parent) {
        const f = parent.folder('dynamic-ibl', { expanded: false });
        f.add(this, 'iblBudget', { label: 'budget-slices', min: 1, max: this.ibl.sliceCount, step: 1 });
        f.add(this, 'iblInterval', { label: 'update-interval', min: 1, max: 10, step: 1 });
        f.button('refresh-env', () => this.refreshEnvironment());
        f.button('profile-prefilter', async () => {
            const ms = await this.ibl.profile();
            console.log(ms === null ? '[sky] timestamp-query unavailable' : `[sky] full prefilter burst: ${ms.toFixed(3)} ms`);
        });
    }

    dispose() {
        this.mesh?.parent?.removeChild?.(this.mesh);
        this.pipeline?.destroy();
        this.geometry?.destroy();
        this.transmittanceTexture?.destroy();
        this.skyviewTexture?.destroy();
        if (this.ibl) {
            this.ibl.sourceCube.destroy();
            this.ibl.prefiltered.texture.destroy();
        }
    }
}
