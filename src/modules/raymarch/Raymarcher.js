// SDF raymarcher integrated depth-correctly into the rasterized scene.
// Extends Mesh and is drawn as scene content (opaque bucket, late renderOrder):
// the fragment shader sphere-traces a storage-buffer primitive list, writes
// projected hit depth to frag_depth and discards on miss, so raster geometry
// occludes and is occluded by the SDF surface with no compositing pass.

import { Mesh } from '@core/Mesh';
import { RenderPipeline } from '@core/RenderPipeline';
import { FullscreenTriangle } from '@core/primitives/FullscreenTriangle.js';
import { Mat4, Quat, Vec3 } from '@math';
import { createStorageBuffer } from '@utils/BufferUtils';

import shaderCode from './raymarch.wgsl?raw';
import { PRESETS } from './presets.js';

export const PRIMITIVE_KINDS = { sphere: 0, box: 1, torus: 2, capsule: 3, plane: 4 };

const MAX_MATERIALS = 8;
const FLOATS_PER_PRIMITIVE = 24; // mat4x4f (16) + vec4f params (4) + kind/blendK/materialId/scale (4)

const TIER_STEPS = { low: 40, medium: 64, high: 96, ultra: 128 };
const TIER_PRIM_CAP = { low: 8, medium: 16 };

const _m = /* @__PURE__ */ new Mat4();
const _p = /* @__PURE__ */ new Vec3();
const _q = /* @__PURE__ */ new Quat();
const _s = /* @__PURE__ */ new Vec3();

export class Raymarcher extends Mesh {
    /**
     * @param {object} gpu Renderer GPU context (`renderer.gpu`).
     * @param {object} options
     * @param {object} [options.post] PostProcessing composer. When set, the pipeline
     *   targets the composer's MRT sceneTarget + depth32float depth state; when
     *   omitted, it draws to the swapchain with the engine's default depth and the
     *   MRT normal output is stripped from the shader (+ tonemap baked in).
     * @param {object} [options.ibl] Result of `loadIBLCubeMap` ({ view, mipLevels }).
     *   Optional — falls back to a black 1x1 cube (env light off).
     * @param {string} [options.preset] Initial preset from presets.js.
     * @param {number} [options.maxPrimitives]
     * @param {number} [options.maxSteps] Sphere-trace step cap (baked override).
     * @param {boolean} [options.bounce] Single reflection re-march for reflective
     *   materials. Also gated per quality tier (forced off on 'low').
     * @param {number} [options.envIntensity]
     * @param {string} [options.label]
     */
    constructor(gpu, { post = null, ibl = null, preset = 'metaballs', maxPrimitives = 32, maxSteps = 96, bounce = true, envIntensity = 1, label = 'raymarcher' } = {}) {
        if (!gpu) throw new Error('Raymarcher: no WebGPU context provided');

        const geometry = new FullscreenTriangle(gpu);

        // Swapchain variant: a single color target can't take the MRT normal
        // output — strip the `//! mrt`-tagged lines before compile. (Hot-reload
        // feeds raw file content, so it won't re-apply this transform; the post
        // path — the primary one — hot-reloads normally.)
        const code = post ? shaderCode : shaderCode.replace(/^.*\/\/!\s*mrt.*$\n?/gm, '');

        // Same object reference RenderPipeline stashes in _buildOpts — mutating
        // it + pipeline.build(code) rebakes overrides (see setQuality).
        const constants = {
            maxSteps,
            roughnessLevels: ibl?.mipLevels ?? 1,
            tonemap: post ? 0 : 1,
        };

        const pipeline = new RenderPipeline(gpu, {
            label,
            code,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
            constants,
            ...(post ? { targets: post.sceneTarget.getTargets(), depthStencil: post.depthStencil } : {}),
        });

        const primBuffer = createStorageBuffer(gpu, {
            label: `${label}-primitive-buffer`,
            size: maxPrimitives * FLOATS_PER_PRIMITIVE * 4,
            usage: GPUBufferUsage.COPY_DST,
        });

        let envView = ibl?.view;
        if (!envView) {
            // WebGPU zero-initializes — a black env cube, i.e. no image lighting.
            const fallback = gpu.device.createTexture({
                label: `${label}-env-fallback`,
                size: [1, 1, 6],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING,
            });
            envView = fallback.createView({ dimension: 'cube' });
        }

        const iblSampler = gpu.device.createSampler({
            label: `${label}-ibl-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });

        super(gpu, {
            label,
            pipeline,
            geometry,
            // Late in the opaque bucket: the populated depth buffer rejects hidden
            // marches at the (late) depth test — frag_depth already disables
            // early-z, so drawing last is the cheap ordering.
            renderOrder: 100,
            // clip-space triangle verts are meaningless to the world-space culler
            frustumCulled: false,
            bindGroups: (uniformBuffer) => [
                gpu.device.createBindGroup({
                    label: `${label}-bind-group`,
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: { buffer: primBuffer } },
                        { binding: 2, resource: envView },
                        { binding: 3, resource: iblSampler },
                    ],
                }),
            ],
        });

        this.post = post;
        this.maxPrimitives = maxPrimitives;
        this.bounce = bounce;
        this.envIntensity = envIntensity;
        this.morph = 0.5;

        this._code = code;
        this._constants = constants;
        this._maxSteps = maxSteps;
        this._tierBounce = true;
        this._tierPrimCap = maxPrimitives;

        this._primBuffer = primBuffer;
        this._primF32 = new Float32Array(maxPrimitives * FLOATS_PER_PRIMITIVE);
        this._primU32 = new Uint32Array(this._primF32.buffer);
        this._count = 0;
        this._dirty = false;

        this._invProj = new Mat4();

        this.onBeforeRender(({ camera }) => this._updateFrame(camera));

        this.setPreset(preset);
    }

    /**
     * Write primitive slot `i`. `kind` is a PRIMITIVE_KINDS name, `rotation` a
     * quaternion ([x,y,z,w]), `scale` a number or [x,y,z] (distances rescale by
     * the min axis — conservative, so marching stays correct under non-uniform
     * scale), `params` per kind: sphere [radius], box [hx,hy,hz,cornerRadius],
     * torus [R,r], capsule [halfHeight,radius], plane [] (local y=0).
     */
    setPrimitive(i, { kind = 'sphere', position = [0, 0, 0], rotation = null, scale = 1, params = [1, 0, 0, 0], blendK = 0, materialId = 0 } = {}) {
        if (i < 0 || i >= this.maxPrimitives) {
            console.warn(`[${this.label}] primitive index ${i} out of range (max ${this.maxPrimitives})`);
            return this;
        }

        const sv = Array.isArray(scale) ? scale : [scale, scale, scale];
        _p.fromArray(position);
        _q.fromArray(rotation || [0, 0, 0, 1]);
        _s.fromArray(sv);
        _m.compose(_p, _q, _s).invert();

        const o = i * FLOATS_PER_PRIMITIVE;
        const f = this._primF32;
        f.set(_m, o);
        for (let c = 0; c < 4; c++) f[o + 16 + c] = params[c] ?? 0;
        this._primU32[o + 20] = PRIMITIVE_KINDS[kind] ?? 0;
        f[o + 21] = blendK;
        this._primU32[o + 22] = Math.min(materialId, MAX_MATERIALS - 1);
        f[o + 23] = Math.min(sv[0], sv[1], sv[2]);

        this._count = Math.max(this._count, i + 1);
        this._dirty = true;
        return this;
    }

    clearPrimitives() {
        this._count = 0;
        this._dirty = true;
        return this;
    }

    /** Material slot (0..7): base color/roughness/metallic + reflectivity (0..1, drives the bounce). */
    setMaterial(id, { color = [1, 1, 1], roughness = 0.5, metallic = 0, reflectivity = 0 } = {}) {
        if (id < 0 || id >= MAX_MATERIALS) {
            console.warn(`[${this.label}] material index ${id} out of range (max ${MAX_MATERIALS})`);
            return this;
        }
        const m = this.uniforms.views.materials;
        const o = id * 8;
        m[o] = color[0];
        m[o + 1] = color[1];
        m[o + 2] = color[2];
        m[o + 3] = roughness;
        m[o + 4] = metallic;
        m[o + 5] = reflectivity;
        return this;
    }

    setPreset(name) {
        const preset = PRESETS[name];
        if (!preset) {
            console.warn(`[${this.label}] unknown preset '${name}'`);
            return this;
        }
        this.preset = name;
        this._preset = preset;
        this._count = 0;
        (preset.materials || []).forEach((mat, i) => this.setMaterial(i, mat));
        preset.build?.(this);
        this._dirty = true;
        return this;
    }

    /** PerformanceProfile tier: rebakes maxSteps, caps primitives, gates the bounce. */
    setQuality(tier) {
        this._tierBounce = tier !== 'low';
        this._tierPrimCap = TIER_PRIM_CAP[tier] ?? this.maxPrimitives;
        const steps = TIER_STEPS[tier] ?? 96;
        if (steps !== this._maxSteps) this.setMaxSteps(steps);
        return this;
    }

    setMaxSteps(steps) {
        this._maxSteps = steps;
        this._constants.maxSteps = steps;
        // rebake overrides — Mesh.draw absorbs the defs swap on the next draw
        this.pipeline.build(this._code);
        return this;
    }

    addGUI(gui) {
        const folder = gui.folder('raymarcher');

        const proxy = { preset: this.preset, steps: this._maxSteps };
        folder
            .add(proxy, 'preset', { options: Object.fromEntries(Object.keys(PRESETS).map((k) => [k, k])) })
            .on('change', (ev) => this.setPreset(ev.value));
        folder.add(this, 'morph', { min: 0, max: 1, step: 0.001 });
        folder.add(proxy, 'steps', { options: { 40: 40, 64: 64, 96: 96, 128: 128 }, label: 'max-steps' }).on('change', (ev) => this.setMaxSteps(ev.value));
        folder.add(this, 'bounce');
        folder.add(this, 'envIntensity', { min: 0, max: 3, step: 0.01, label: 'env-intensity' });

        return folder;
    }

    _updateFrame(camera) {
        if (!camera) return;

        this._preset?.animate?.(this, { time: this.gpu.renderer.time || 0, morph: this.morph });

        // Inverses of the LIVE matrices — the composer's TAA jitter is applied to
        // projectionMatrix for the whole frame, so rays and frag_depth stay
        // consistent with the rasterized depth buffer.
        this._invProj.copy(camera.projectionMatrix).invert();
        this.uniforms.set({
            inverseProjectionMatrix: this._invProj,
            inverseViewMatrix: camera.worldMatrix,
            primitiveCount: Math.min(this._count, this._tierPrimCap),
            bounce: this.bounce && this._tierBounce ? 1 : 0,
            cameraFar: camera.far ?? 100,
            envIntensity: this.envIntensity,
        });

        if (this._dirty) {
            this.gpu.device.queue.writeBuffer(this._primBuffer, 0, this._primF32, 0, this._count * FLOATS_PER_PRIMITIVE);
            this._dirty = false;
        }
    }
}
