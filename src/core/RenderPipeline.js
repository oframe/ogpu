let ID = 1;

import { reflect, bindGroupLayoutDescriptors } from './reflect/index.js';
import { internBindGroupLayout } from './BindGroupLayout.js';
import { registerShader } from './ShaderReload';
import { applyOverrideConstants } from '@utils/wgslOverrides';
import { TextureFormat, BlendFactor } from './GPUEnums.js';

// An explicit GPURenderPipeline for fullscreen passes and other non-Mesh draws
// (fixed geometry + fixed target, so the renderer's pipeline cache buys nothing).
// No engine block, a fully reflected layout, nothing dynamic: callers own their
// uniform buffers and bind groups (bindGroupLayout(i).createBindGroup). Meshes use
// Shader + state instead and never see one of these.

export class RenderPipeline {
    constructor(
        gpu,
        {
            label = 'rendering',
            code = ``,
            vertexBuffers = [],
            targets,
            depthTest = true,
            depthWrite = true,
            depthStencil = {},
            transparent = false,
            cullMode = 'back',
            topology = 'triangle-list',
            blending = {},
            sampleCount = 1,
            constants = {},
        } = {}
    ) {
        if (!gpu) throw new Error(`[render-pipeline ${label}] no webgpu context (gpu) provided`);
        if (!code) throw new Error(`[render-pipeline ${label}] no shader code provided`);

        this.label = label;
        this.gpu = gpu;
        this.depthTest = depthTest;
        this.depthWrite = depthWrite;
        this.depthStencil = depthStencil;
        this.transparent = transparent;
        this.cullMode = cullMode;
        this.id = ID++;
        // vertex buffer layout(s) only, e.g. gpu.TRIANGLE.bufferLayouts — the
        // caller binds the actual buffers per draw
        this.vertexBuffers = vertexBuffers;

        // stash everything build() needs so a hot-reload can rebuild the
        // GPU pipeline from fresh WGSL without re-running the example.
        this._buildOpts = { targets, topology, blending, sampleCount, constants };

        try {
            this.build(code);
        } catch (e) {
            throw new Error(`[render-pipeline ${label}] shader build failed: ${e.message}`, { cause: e });
        }

        this._unregister = registerShader(this);
    }

    // (Re)compiles the shader module and (re)creates the GPURenderPipeline.
    // Called once from the constructor and again on each hot-reload.
    build(code) {
        this.code = code;

        const { targets, topology, blending, sampleCount, constants } = this._buildOpts;

        // Bake override constants into source (Safari has no pipeline-override
        // support) instead of passing them to the pipeline descriptor.
        const bakedCode = applyOverrideConstants(code, constants);

        this.module = this.gpu.device.createShaderModule({
            label: this.label,
            code: bakedCode,
        });

        this.defs = reflect(bakedCode);

        let _targets = targets?.length > 0.0 ? targets : [{ format: this.gpu.presentationFormat }];
        let _blending = blending;

        if (this.transparent || _blending.color) {
            _blending = _blending.color
                ? // alpha is required by GPUBlendState — default it when the caller omits it
                  {
                      alpha: { srcFactor: BlendFactor.SRC_ALPHA, dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA },
                      ..._blending,
                  }
                : {
                      color: {
                          srcFactor: BlendFactor.SRC_ALPHA,
                          dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA,
                      },
                      alpha: {
                          srcFactor: BlendFactor.SRC_ALPHA,
                          dstFactor: BlendFactor.ONE_MINUS_SRC_ALPHA,
                      },
                  };

            // caller-owned descriptors, don't mutate
            _targets = _targets.map((t) => ({ ...t, blend: _blending }));
        }

        const pipelineDesc = {
            vertex: {
                entryPoint: 'vs',
                module: this.module,
                buffers: this.vertexBuffers,
            },
            multisample: {
                count: sampleCount,
            },
        };

        // Depth-only passes (e.g. shadow maps) ship a vertex-only module with
        // no `fs` entry point — omit the fragment stage so the pipeline has no
        // color targets.
        if (this.defs.entryPoints?.fs) {
            pipelineDesc.fragment = {
                entryPoint: 'fs',
                module: this.module,
                targets: _targets,
            };
        }

        const stages = pipelineDesc.fragment ? ['vs', 'fs'] : ['vs'];
        const descriptors = bindGroupLayoutDescriptors(this.defs, stages);

        // Explicit layouts, interned by shape (BindGroupLayout.js): callers build
        // bind groups from bindGroupLayout(i) instead of reaching into the compiled
        // pipeline, and a hot reload that keeps the shape hands back the same
        // objects, so those bind groups survive it.
        const { device } = this.gpu;
        this._bindGroupLayouts = descriptors.map((d, i) => internBindGroupLayout(device, this.defs, i, d.entries, this.label, stages));

        const layout = device.createPipelineLayout({
            bindGroupLayouts: this._bindGroupLayouts.map((l) => l.layout),
        });

        // depthStencil resolves three ways:
        //   false           -> omit depth state (fullscreen/blit passes, VFX)
        //   {} (default)     -> engine default depth24plus state
        //   populated object -> dev-supplied state verbatim (e.g. shadow-map
        //                       passes needing depthBias / depth32float)
        const depthStencil =
            this.depthStencil && Object.keys(this.depthStencil).length
                ? this.depthStencil
                : this.depthStencil // {} is truthy -> use engine default; false -> null
                  ? {
                        depthWriteEnabled: this.depthWrite,
                        depthCompare: !this.depthTest ? 'always' : 'less',
                        format: TextureFormat.DEPTH24PLUS,
                    }
                  : null;

        this.pipeline = this.gpu.device.createRenderPipeline({
            label: this.label,
            layout,
            ...pipelineDesc,
            primitive: {
                cullMode: this.cullMode,
                topology,
            },
            ...(depthStencil ? { depthStencil } : {}),
        });
    }

    // The BindGroupLayout for `groupIndex` (raw GPUBindGroupLayout at `.layout`);
    // the caller builds and owns the bind group: bindGroupLayout(0).createBindGroup({ … }).
    bindGroupLayout(groupIndex = 0) {
        const layout = this._bindGroupLayouts[groupIndex];
        if (!layout) throw new Error(`[render-pipeline ${this.label}] has no group(${groupIndex})`);
        return layout;
    }

    // Hot-reload entry point; bind groups built from bindGroupLayout(i) stay
    // valid while the binding shape is unchanged (same interned layouts).
    reload(code) {
        try {
            this.build(code);
            console.log(`[hot] reloaded render pipeline '${this.label}'`);
        } catch (e) {
            console.error(`[hot] failed to reload render pipeline '${this.label}'`, e);
        }
    }

    destroy() {
        this._unregister?.();
    }
}
