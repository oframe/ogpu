import { BlendFactor } from './GPUEnums.js';

// PipelineRegistry: the renderer's GPURenderPipelines, derived, never built by hand.
// It builds each pipeline on first request and hands every later asker the same
// object.
//
// A WebGPU pipeline bakes four things together: the shader, the mesh's `state`
// (blend, depth, cull, topology), the geometry's vertex layout, and the pass's
// colour/depth formats + sample count. The last is only known when the mesh is
// drawn, so a Mesh can't own its pipeline; every draw asks the registry.
//
// Two levels:
//   map   key string → pipeline, shared by every mesh with that key. Equal
//         pipelines are the same object, so a draw can skip setPipeline with
//         one === (Mesh's BoundState).
//   memo  per mesh and pass kind: the last answer, reused while its inputs are
//         the same objects. A steady-state draw does five === and no strings.
//         `state` is compared by identity, which is why Mesh freezes it.
//
// Reading order: the idea (get, key, descriptor, passInfo), then the hardening,
// each section opening with the problem it solves.

export class PipelineRegistry {
    constructor(gpu) {
        this.gpu = gpu;
        this.map = new Map(); // key → pipeline, or null for a key that can't build
        this._passIds = new Map();
        // bumped when anything derived from the registry may be stale (clear(), or a
        // key that turned out invalid): mesh memos and RenderBundleGroup bundles
        // compare against it
        this.version = 0;
    }

    // ── The idea ─────────────────────────────────────────────────────────────

    // The pipeline that draws `mesh` in a pass of kind `passInfo`; null when it
    // can't be built (already reported): skip the draw.
    get(mesh, passInfo) {
        const { shader, state, geometry } = mesh;
        // Fast path: same inputs as this mesh's last draw in this kind of pass.
        // One memo per pass kind, so a mesh drawn into a target and the canvas
        // each frame stays on it.
        const memos = (mesh._pipelineMemos ??= []);
        let m = memos[passInfo.id];
        if (m && m.shader === shader && m.shaderVersion === shader.version && m.state === state && m.geometry === geometry && m.registryVersion === this.version) {
            return m.pipeline;
        }

        // Slow path: describe the pipeline as a string; equal keys share one.
        const key = this.key(mesh, passInfo);
        let pipeline = this.map.get(key);
        if (pipeline === undefined) {
            pipeline = this._create(mesh, passInfo, key);
            this.map.set(key, pipeline);
        }

        m = memos[passInfo.id] ??= {};
        m.shader = shader;
        m.shaderVersion = shader.version;
        m.state = state;
        m.geometry = geometry;
        m.registryVersion = this.version;
        m.pipeline = pipeline;
        return pipeline;
    }

    // Everything the pipeline depends on, as one string.
    key(mesh, passInfo) {
        const { shader, state, geometry } = mesh;
        // strips bake the index format into the pipeline
        const topology = resolveState(state).topology;
        const strip = topology === 'triangle-strip' || topology === 'line-strip';
        const index = strip ? `|${geometry.nonInstancedVerts?.indexFormat ?? ''}` : '';
        return `${shader.id}.${shader.version}|${stateKey(state)}|${geometry.layoutKey}${index}|${passInfo.key}`;
    }

    // Stages from the Shader, vertex buffers from the Geometry, primitive, blend
    // and depth from `state`, targets from the pass.
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

    // A pass's formats as one stable object; its small `id` indexes the memos.
    passInfo(colorFormats, depthFormat, sampleCount) {
        const key = `${colorFormats.join(',')}|${depthFormat ?? ''}|${sampleCount}`;
        let info = this._passIds.get(key);
        if (!info) {
            info = { colorFormats, depthFormat, sampleCount, key, id: this._passIds.size + 1 };
            this._passIds.set(key, info);
        }
        return info;
    }

    // ── Hardening: a pipeline that can't be built, now or later ──────────────
    //
    // A bad state enum, a vertex input the geometry lacks, a shader from a lost
    // device: the key caches null, reported once, and every mesh on it skips its
    // draws; nothing throws mid-pass. It's retried when the key changes (a shader
    // rebuild bumps `shader.version`) or clear() empties the map.
    //
    // Later: createRenderPipeline returns an object that only turns out invalid
    // when the error scope resolves. Draws in that window (a frame or two) encode
    // it and invalidate their command buffer; when the error lands, the key goes
    // null and `version` moves, so memos and bundles drop it.

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
                // Keyed on identity, not version: a second key failing in the same
                // frame must be nulled too, and clear() has already dropped the entry.
                if (pipeline && this.map.get(key) === pipeline) {
                    this.map.set(key, null);
                    this.version++;
                }
            });
        }
    }

    // ── Hardening: warm-up without first-draw stalls ─────────────────────────
    //
    // A pipeline built on first draw compiles inside that frame. renderer.compile()
    // builds ahead with createRenderPipelineAsync; a failure caches null (reported
    // once per key) like a synchronous one.

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

    // ── Hardening: device restore ────────────────────────────────────────────
    //
    // Pipelines belong to the device that built them. The new device starts from
    // an empty map and `version` moves, so memos and bundles from before drop
    // out; a compileAsync still awaiting the old device drops its result.

    clear() {
        this.map.clear();
        this._passIds.clear();
        this.version++;
    }

    // ── Names, for captures and errors ───────────────────────────────────────
    //
    // An unnamed pipeline can't be found in a GPU capture or traced from an error.

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
        console.error(new Error(`[pipeline-registry] no pipeline for mesh '${mesh.label}' with shader '${mesh.shader.label}'${what}: ${error.message}`, { cause: error }));
    }
}

// ── State: defaults, key, blend ──────────────────────────────────────────────

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

// explicit `undefined` keeps the default, like the old destructuring defaults
export function resolveState(state) {
    const s = { ...STATE_DEFAULTS };
    for (const k in state) if (state[k] !== undefined) s[k] = state[k];
    return s;
}

// one string per state object, built once (states are frozen)
const _stateKeys = new WeakMap();

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

// ── Checks before building ───────────────────────────────────────────────────

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
            `[pipeline-registry] mesh '${mesh.label}': shader '${mesh.shader.label}' reads ${missing.map((i) => `@location(${i.location}) ${i.name}`).join(', ')} — not in the geometry's vertex layout`
        );
    }
}
