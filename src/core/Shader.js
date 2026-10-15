import engineCode from './engine.wgsl?raw';
import { reflect, bindGroupLayoutDescriptors } from './reflect/index.js';
import { registerShader } from './ShaderReload.js';
import { UniformBuffer } from './UniformBuffer.js';
import { applyOverrideConstants } from '@utils/wgslOverrides';

export const ENGINE_GROUP = 1;

let ID = 1;

// Shader module + its reflected interface: the `uniforms` struct, bind group
// layouts and a pipeline layout. No geometry, targets or blend/depth state —
// the renderer derives GPURenderPipelines from (shader, mesh.state, geometry
// layout, pass formats). The engine block (camera/object at group(1)) is
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
            const own = defs.entryPoints[name]?.resources.find((r) => r.group === ENGINE_GROUP && r.name !== 'camera' && r.name !== 'object');
            if (own) {
                throw new Error(`'${own.name}' is bound at group(1), which is the engine's — use group(0), 2 or 3`);
            }
        }

        const module = device.createShaderModule({ label: this.label, code: baked });
        const hasFragment = defs.entryPoints.fs?.stage === GPUShaderStage.FRAGMENT;
        const descriptors = bindGroupLayoutDescriptors(defs, hasFragment ? ['vs', 'fs'] : ['vs'], {
            skip: [ENGINE_GROUP],
        });

        // every slot below the highest group gets a layout; empty slots share the
        // renderer's empty layout so `renderer.emptyBindGroup` binds there
        const layouts = [];
        const count = Math.max(ENGINE_GROUP + 1, descriptors.length);
        for (let i = 0; i < count; i++) {
            if (i === ENGINE_GROUP) layouts.push(renderer.engineLayout);
            else if (descriptors[i]?.entries.length) {
                layouts.push(
                    device.createBindGroupLayout({
                        label: `${this.label}-group-${i}-layout`,
                        ...descriptors[i],
                    })
                );
            } else layouts.push(renderer.emptyLayout);
        }

        const prevSize = this.uniforms?.size;

        this.code = code;
        this.module = module;
        this.defs = defs;
        // struct of `var<uniform> uniforms`, if declared — feed it to UniformBuffer
        this.uniforms = defs.uniforms.uniforms;
        this.hasFragment = hasFragment;
        this._layouts = layouts;
        this.pipelineLayout = device.createPipelineLayout({
            label: `${this.label}-layout`,
            bindGroupLayouts: layouts,
        });
        this.version++;

        if (prevSize !== undefined && this.uniforms?.size !== prevSize) {
            console.warn(`[hot] ${this.label}: uniforms struct changed size (${prevSize} -> ${this.uniforms?.size ?? 0} B) — recreate UniformBuffers and bind groups built from it`);
        }
    }

    bindGroupLayout(group = 0) {
        return this._layouts[group];
    }

    // Resources by WGSL name: shader.bindGroup(0, { uniforms, tMap: view, samp: sampler }).
    // A UniformBuffer or GPUBuffer binds whole; `{ buffer, offset, size }` and
    // views/samplers/external textures pass through. A name declared in this group
    // but unused by vs/fs is dropped (it's absent from the derived layout); a name
    // the WGSL doesn't declare in this group throws.
    bindGroup(group, resources, { label } = {}) {
        if (group === ENGINE_GROUP) throw new Error(`[shader ${this.label}] group(1) is the engine's`);
        const layout = this._layouts[group];
        if (!layout) throw new Error(`[shader ${this.label}] has no group(${group})`);

        const used = this._usedBindings(group);
        const entries = [];
        for (const name in resources) {
            const binding = this._bindingOf(group, name);
            if (!used.has(binding)) continue;
            entries.push({ binding, resource: asResource(resources[name]) });
        }
        return this.gpu.device.createBindGroup({
            label: label ?? `${this.label}-group-${group}`,
            layout,
            entries,
        });
    }

    _bindingOf(group, name) {
        const d = this.defs;
        const v = d.uniforms[name] ?? d.storages[name] ?? d.textures[name] ?? d.samplers[name] ?? d.storageTextures[name] ?? d.externalTextures[name];
        if (!v || v.group !== group) {
            const names = this._declaredNames(group);
            throw new Error(`[shader ${this.label}] no binding '${name}' in group(${group}) — declared: ${names.join(', ') || 'none'}`);
        }
        return v.binding;
    }

    _declaredNames(group) {
        const d = this.defs;
        return [d.uniforms, d.storages, d.textures, d.samplers, d.storageTextures, d.externalTextures].flatMap((vars) => Object.keys(vars).filter((n) => vars[n].group === group));
    }

    _usedBindings(group) {
        const used = new Set();
        for (const name of this.hasFragment ? ['vs', 'fs'] : ['vs']) {
            for (const r of this.defs.entryPoints[name].resources) {
                if (r.group === group) used.add(r.entry.binding);
            }
        }
        return used;
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

function asResource(r) {
    if (r instanceof GPUBuffer) return { buffer: r };
    if (r instanceof UniformBuffer) return { buffer: r.buffer };
    return r;
}
