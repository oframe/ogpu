import { BlendFactor } from './GPUEnums.js';

// Renderer-owned GPURenderPipeline cache. A pipeline is derived from
// (shader id + version, mesh.state, geometry.layoutKey, pass formats + sample
// count) — user code never builds one for a Mesh. Each mesh memoizes its last
// lookup by identity, so a steady-state draw does no string work.
//
// `state` objects are compared by identity: replace one (`mesh.state = glass`),
// don't mutate it — Mesh freezes the object (and its `blending`) so a mutation
// throws. A pipeline that can't be built is reported once (naming the mesh and
// the shader) and every mesh with that key skips its draws until the shader is
// rebuilt (new `version`) or the cache is cleared; nothing throws mid-pass.

const ALPHA_BLEND = {
    color: { srcFactor: BlendFactor.SRC_ALPHA, dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA },
    alpha: { srcFactor: BlendFactor.SRC_ALPHA, dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA },
};

const STATE_DEFAULTS = {
    transparent: false,
    depthWrite: true,
    depthTest: true,
    depthCompare: undefined, // derived from depthTest when unset
    depthBias: 0,
    depthBiasSlopeScale: 0,
    depthBiasClamp: 0,
    cullMode: 'back',
    frontFace: 'ccw',
    topology: 'triangle-list',
    blending: undefined,
    writeMask: undefined,
};

const _stateKeys = new WeakMap();

// explicit `undefined` keeps the default, like the old destructuring defaults
export function resolveState(state) {
    const s = { ...STATE_DEFAULTS };
    for (const k in state) if (state[k] !== undefined) s[k] = state[k];
    return s;
}

function stateKey(state) {
    let key = _stateKeys.get(state);
    if (key === undefined) {
        const s = resolveState(state);
        key = JSON.stringify([
            s.transparent,
            s.depthWrite,
            s.depthTest,
            s.depthCompare ?? null,
            s.depthBias,
            s.depthBiasSlopeScale,
            s.depthBiasClamp,
            s.cullMode,
            s.frontFace,
            s.topology,
            s.blending ?? null,
            s.writeMask ?? null,
        ]);
        _stateKeys.set(state, key);
    }
    return key;
}

function blendOf(s) {
    if (s.blending?.color) return { alpha: ALPHA_BLEND.alpha, ...s.blending };
    return s.transparent ? ALPHA_BLEND : undefined;
}

function describeState(s) {
    const parts = [];
    if (s.transparent || s.blending) parts.push('blend');
    if (!s.depthWrite) parts.push('no-depth-write');
    if (!s.depthTest) parts.push('no-depth-test');
    if (s.depthBias || s.depthBiasSlopeScale) parts.push('bias');
    if (s.cullMode !== 'back') parts.push(`cull-${s.cullMode}`);
    if (s.topology !== 'triangle-list') parts.push(s.topology);
    if (s.writeMask === 0) parts.push('no-color-write');
    return parts;
}

// A shader built on another device (one lost before a restore, and not rebuilt
// in a deviceRestoredHandler) can't make a pipeline. Caught here, synchronously:
// createRenderPipeline would hand back an invalid pipeline that every mesh with
// the same key draws with until the validation error resolves.
function checkDevice(mesh, device) {
    if (mesh.shader.device !== device) {
        throw new Error(`shader '${mesh.shader.label}' was built on another (lost) device — rebuild it in a deviceRestoredHandler`);
    }
}

// every @location the vertex stage reads must come from the geometry
function checkVertexInputs(mesh) {
    const provided = new Set();
    for (const layout of mesh.geometry.bufferLayouts) {
        for (const a of layout.attributes) provided.add(a.shaderLocation);
    }
    const missing = mesh.shader.defs.entryPoints.vs.inputs.filter((i) => !provided.has(i.location));
    if (missing.length) {
        throw new Error(
            `[pipeline-cache] mesh '${mesh.label}': shader '${mesh.shader.label}' reads ${missing.map((i) => `@location(${i.location}) ${i.name}`).join(', ')} — not in the geometry's vertex layout`
        );
    }
}

export class PipelineCache {
    constructor(gpu) {
        this.gpu = gpu;
        this.map = new Map();
        this._passIds = new Map();
        // bumped by clear() (device restore) and by an async validation failure:
        // per-mesh memos (and RenderBundleGroup bundles) from before are stale
        this.generation = 0;
    }

    // passInfo = { colorFormats, depthFormat, sampleCount } → stable { ...,  key, id }
    passInfo(colorFormats, depthFormat, sampleCount) {
        const key = `${colorFormats.join(',')}|${depthFormat ?? ''}|${sampleCount}`;
        let info = this._passIds.get(key);
        if (!info) {
            info = { colorFormats, depthFormat, sampleCount, key, id: this._passIds.size + 1 };
            this._passIds.set(key, info);
        }
        return info;
    }

    // null when the pipeline can't be built (already reported) — skip the draw
    get(mesh, passInfo) {
        const { shader, state, geometry } = mesh;
        // one memo per pass kind, so a mesh drawn into a target and the canvas
        // each frame stays on the fast path
        const memos = (mesh._pipelineMemos ??= []);
        let m = memos[passInfo.id];
        if (m && m.shader === shader && m.version === shader.version && m.state === state && m.geometry === geometry && m.generation === this.generation) {
            return m.pipeline;
        }

        const key = this.key(mesh, passInfo);
        let pipeline = this.map.get(key);
        if (pipeline === undefined) {
            pipeline = this._create(mesh, passInfo, key);
            this.map.set(key, pipeline);
        }

        m = memos[passInfo.id] ??= {};
        m.shader = shader;
        m.version = shader.version;
        m.state = state;
        m.geometry = geometry;
        m.generation = this.generation;
        m.pipeline = pipeline;
        return pipeline;
    }

    _create(mesh, passInfo, key) {
        const { device } = this.gpu;
        let descriptor;
        let pipeline = null;
        device.pushErrorScope('validation');
        try {
            checkDevice(mesh, device);
            checkVertexInputs(mesh);
            descriptor = this.descriptor(mesh, passInfo);
            pipeline = device.createRenderPipeline(descriptor);
            return pipeline;
        } catch (error) {
            this._report(mesh, descriptor, error);
            return null;
        } finally {
            device.popErrorScope().then((error) => {
                if (!error) return;
                this._report(mesh, descriptor, error);
                // invalid pipeline: later draws skip instead of invalidating the pass.
                // Keyed on identity, not generation: a second key failing in the same
                // frame must be nulled too, and clear() has already dropped the entry.
                if (pipeline && this.map.get(key) === pipeline) {
                    this.map.set(key, null);
                    this.generation++;
                }
            });
        }
    }

    // Warm-up: compile asynchronously, then later draws hit the cache.
    async compileAsync(mesh, passInfo) {
        const key = this.key(mesh, passInfo);
        if (this.map.has(key)) return this.map.get(key);
        let descriptor;
        let pipeline;
        // a device restore during the await makes the result foreign: drop it
        const device = this.gpu.device;
        try {
            checkDevice(mesh, device);
            checkVertexInputs(mesh);
            descriptor = this.descriptor(mesh, passInfo);
            pipeline = await device.createRenderPipelineAsync(descriptor);
        } catch (error) {
            if (this.gpu.device !== device) return null;
            // reported once per key: later draws find the null and skip
            if (!this.map.has(key)) {
                this._report(mesh, descriptor, error);
                this.map.set(key, null);
            }
            return null;
        }
        if (this.gpu.device !== device) return null;
        if (!this.map.has(key)) this.map.set(key, pipeline);
        return this.map.get(key);
    }

    key(mesh, passInfo) {
        const { shader, state, geometry } = mesh;
        // strips bake the index format into the pipeline
        const topology = resolveState(state).topology;
        const strip = topology === 'triangle-strip' || topology === 'line-strip';
        const index = strip ? `|${geometry.nonInstancedVerts?.indexFormat ?? ''}` : '';
        return `${shader.id}.${shader.version}|${stateKey(state)}|${geometry.layoutKey}${index}|${passInfo.key}`;
    }

    descriptor(mesh, passInfo) {
        const { shader, geometry } = mesh;
        const s = resolveState(mesh.state);
        const blend = blendOf(s);
        const indexFormat = geometry.nonInstancedVerts?.indexFormat;
        const strip = s.topology === 'triangle-strip' || s.topology === 'line-strip';

        const descriptor = {
            label: this.describe(mesh, passInfo, s),
            layout: shader.pipelineLayout,
            vertex: { module: shader.module, entryPoint: 'vs', buffers: geometry.bufferLayouts },
            primitive: {
                topology: s.topology,
                cullMode: s.cullMode,
                frontFace: s.frontFace,
                ...(strip && indexFormat && { stripIndexFormat: indexFormat }),
            },
            multisample: { count: passInfo.sampleCount },
        };

        if (shader.hasFragment) {
            descriptor.fragment = {
                module: shader.module,
                entryPoint: 'fs',
                targets: passInfo.colorFormats.map((format) => ({
                    format,
                    ...(blend && { blend }),
                    ...(s.writeMask !== undefined && { writeMask: s.writeMask }),
                })),
            };
        }

        if (passInfo.depthFormat) {
            descriptor.depthStencil = {
                format: passInfo.depthFormat,
                depthWriteEnabled: s.depthWrite,
                depthCompare: s.depthCompare ?? (s.depthTest ? 'less' : 'always'),
                depthBias: s.depthBias,
                depthBiasSlopeScale: s.depthBiasSlopeScale,
                depthBiasClamp: s.depthBiasClamp,
            };
        }
        return descriptor;
    }

    // e.g. 'third-webgpu-box-third-box-shader-blend-no-depth-write-bgra8unorm-depth24plus'
    describe(mesh, passInfo, s = resolveState(mesh.state)) {
        const formats = passInfo.colorFormats.length ? passInfo.colorFormats : ['no-color'];
        return [mesh.label, mesh.shader.label, ...describeState(s), ...formats, passInfo.depthFormat, passInfo.sampleCount > 1 && `msaa${passInfo.sampleCount}`]
            .filter(Boolean)
            .join('-')
            .replace(/\s+/g, '-')
            .toLowerCase();
    }

    _report(mesh, descriptor, error) {
        const what = descriptor ? ` (${descriptor.label})` : '';
        console.error(new Error(`[pipeline-cache] no pipeline for mesh '${mesh.label}' with shader '${mesh.shader.label}'${what}: ${error.message}`, { cause: error }));
    }

    clear() {
        this.map.clear();
        this._passIds.clear();
        this.generation++;
    }
}
