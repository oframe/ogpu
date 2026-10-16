import engineCode from './engine.wgsl?raw';
import { reflect, bindGroupLayoutDescriptors } from './reflect/index.js';
import { registerShader } from './ShaderReload.js';
import { internBindGroupLayout, wrapBindGroupLayout, declaredBindings } from './BindGroupLayout.js';
import { applyOverrideConstants } from '@utils/wgslOverrides';

export const ENGINE_GROUP = 1;
// engine.wgsl's per-pass `time` group
export const TIME_GROUP = 3;
// engine.wgsl's group(1) bindings
const ENGINE_NAMES = new Set(['camera', 'object']);
// Shader.needs bits: which derived object matrices the user code reads
export const NEEDS_NORMAL = 1;
export const NEEDS_OBJECT = 2;

let ID = 1;

// Shader module + its reflected interface: the `uniforms` struct, bind group
// layouts and a pipeline layout. No geometry, targets or blend/depth state —
// the renderer derives GPURenderPipelines from (shader, mesh.state, geometry
// layout, pass formats). The engine block (camera/object at group(1), time at group(3)) is
// appended, so user line numbers in compile errors stay correct and `enable`
// directives stay first. Entry points are `vs` and (optionally) `fs`.
export class Shader {
    constructor(gpu, { label = 'shader', code, constants = {} } = {}) {
        if (!gpu?.renderer) throw new Error(`[shader ${label}] no webgpu context (gpu) provided`);
        if (!code) throw new Error(`[shader ${label}] no shader code provided`);

        this.gpu = gpu;
        this.label = label;
        this.id = ID++;
        this.version = 0;
        this._constants = constants;

        try {
            this.build(code);
        } catch (e) {
            throw new Error(`[shader ${label}] build failed: ${e.message}`, { cause: e });
        }
        this._unregister = registerShader(this);
    }

    // (Re)compiles in place; hot reload calls this. Cached pipelines are keyed on
    // `version`, so they rebuild lazily on the next draw.
    build(code) {
        const { device, renderer } = this.gpu;
        const baked = applyOverrideConstants(`${code}\n${engineCode}`, this._constants);
        const defs = reflect(baked);

        if (!defs.entryPoints.vs) throw new Error(`no 'vs' vertex entry point`);
        for (const name of ['vs', 'fs']) {
            const own = defs.entryPoints[name]?.resources.find((r) => r.group === ENGINE_GROUP && !ENGINE_NAMES.has(r.name));
            if (own) {
                throw new Error(`'${own.name}' is bound at group(1), which is the engine's — use group(0) or 2`);
            }
        }
        const timeOwn = declaredBindings(defs, TIME_GROUP).find(([name]) => name !== 'time');
        if (timeOwn) throw new Error(`'${timeOwn[0]}' is bound at group(3), which is the engine's — use group(0) or 2`);

        const module = device.createShaderModule({ label: this.label, code: baked });
        const hasFragment = defs.entryPoints.fs?.stage === GPUShaderStage.FRAGMENT;
        const stages = hasFragment ? ['vs', 'fs'] : ['vs'];
        const descriptors = bindGroupLayoutDescriptors(defs, stages, {
            skip: [ENGINE_GROUP, TIME_GROUP],
        });

        // all four slots get a layout (group(3) is the engine's time group); empty
        // ones share the renderer's empty layout so `renderer.emptyBindGroup` binds there
        const layouts = [];
        const groups = [];
        for (let i = 0; i <= TIME_GROUP; i++) {
            if (i === ENGINE_GROUP) layouts.push(renderer.engineLayout);
            else if (i === TIME_GROUP) layouts.push(renderer.timeLayout);
            else if (descriptors[i]?.entries.length) {
                groups[i] = internBindGroupLayout(device, defs, i, descriptors[i].entries, this.label, stages);
                layouts.push(groups[i].layout);
            } else {
                layouts.push(renderer.emptyLayout);
                // declared but unread by vs/fs: an empty group, so its names still bind (and drop)
                if (declaredBindings(defs, i).length) groups[i] = wrapBindGroupLayout(device, renderer.emptyLayout, defs, i, this.label, { empty: true });
            }
        }

        const prevSize = this.uniforms?.size;

        this.code = code;
        // the pipeline registry refuses a shader from another (lost) device
        this.device = device;
        this.module = module;
        this.defs = defs;
        // struct of `var<uniform> uniforms`, if declared — feed it to UniformBuffer
        this.uniforms = defs.uniforms.uniforms;
        this.hasFragment = hasFragment;
        // A plain text check of the user code (comments included, so it errs
        // toward computing): meshes skip the matrices no shader of theirs reads.
        this.needs = (/\bnormalMatrix\b/.test(code) ? NEEDS_NORMAL : 0) | (/\bobjectMatrix\b/.test(code) ? NEEDS_OBJECT : 0);
        this._groups = groups;
        this.pipelineLayout = device.createPipelineLayout({
            label: `${this.label}-layout`,
            bindGroupLayouts: layouts,
        });
        this.version++;

        if (prevSize !== undefined && this.uniforms?.size !== prevSize) {
            console.warn(`[hot] ${this.label}: uniforms struct changed size (${prevSize} -> ${this.uniforms?.size ?? 0} B) — recreate UniformBuffers and bind groups built from it`);
        }
    }

    // The BindGroupLayout of a user group (0 or 2); build bind groups from it:
    // shader.bindGroupLayout(0).createBindGroup({ uniforms, tMap: view }).
    bindGroupLayout(group = 0) {
        if (group === ENGINE_GROUP || group === TIME_GROUP) throw new Error(`[shader ${this.label}] group(${group}) is the engine's`);
        const layout = this._groups[group];
        if (!layout) throw new Error(`[shader ${this.label}] has no group(${group})`);
        return layout;
    }

    reload(code) {
        try {
            this.build(code);
            console.log(`[hot] reloaded shader '${this.label}'`);
        } catch (e) {
            console.error(`[hot] failed to reload shader '${this.label}'`, e);
        }
    }

    destroy() {
        this._unregister?.();
    }
}
