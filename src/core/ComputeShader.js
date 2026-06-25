import { makeShaderDataDefinitions, makeBindGroupLayoutDescriptors } from 'webgpu-utils';
import { registerShader } from './ShaderReload';
import { applyOverrideConstants } from '@utils/wgslOverrides';

// Wraps a compute module: one pipeline per entry point, keyed by name in this.kernels.
export class ComputeShader {
    constructor(gpu, { label = '', code = ``, layout = 'auto', constants = {}, size = 0 } = {}) {
        if (!gpu) {
            console.error('no webgpu context provided');
            return;
        }

        this.label = label;
        this.gpu = gpu;

        const { device } = this.gpu;

        // kernels object reference stays stable across reloads; only its
        // pipeline values get swapped. Callers should read kernels[name]
        // (or findKernel) at dispatch time rather than caching the value.
        this.kernels = {};

        // stash for hot-reload rebuilds (see ShaderReload.js)
        this._buildOpts = { layout, constants };

        // For layout:'auto', we mint an explicit pipeline layout per entry point
        // ONCE and reuse it across reloads. Auto layouts mint a fresh
        // BindGroupLayout every build, so bind groups created against the old
        // pipeline break on hot-reload ("not created by the pipeline"). Stable
        // explicit layouts keep cached bind groups valid. Keyed by entry-point
        // name: entry-point -> GPUPipelineLayout, and -> GPUBindGroupLayout[].
        this._pipelineLayouts = {};
        this._bindGroupLayouts = {};

        this.build(code);
        this._unregister = registerShader(this);

        this.querySet = device.createQuerySet({
            type: 'timestamp',
            count: 2,
        });

        this.queryBuffer = device.createBuffer({
            size: 8 * 2,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });

        this.queryBufferResult = device.createBuffer({
            size: 8 * 2,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
    }

    // (Re)compiles the module and rebuilds one pipeline per entry point.
    // Mutates this.kernels in place so the object reference stays stable.
    build(code) {
        this.code = code;

        const { layout, constants } = this._buildOpts;

        // Bake override constants into source (Safari has no pipeline-override
        // support) instead of passing them to the pipeline descriptor.
        const bakedCode = applyOverrideConstants(code, constants);

        this.module = this.gpu.device.createShaderModule({
            label: `${this.label}-compute-module`,
            code: bakedCode,
        });

        this.defs = makeShaderDataDefinitions(bakedCode);

        const { entryPoints } = this.defs;

        for (const key in this.kernels) delete this.kernels[key];

        for (let key in entryPoints) {
            this.kernels[key] = this.gpu.device.createComputePipeline({
                label: key,
                layout: this._resolveLayout(key, layout),
                compute: {
                    module: this.module,
                    entryPoint: key,
                },
            });
        }
    }

    // Returns the layout to hand createComputePipeline for entry point `key`.
    // Anything other than 'auto' is passed through untouched. For 'auto' we
    // build an explicit, persistent pipeline layout the first time we see the
    // entry point and reuse the same objects on every reload — that stability
    // is what keeps already-built bind groups compatible across hot-reloads.
    // ponytail: persisted by entry-point name, so changing a shader's binding
    // *shape* (add/remove/retype a binding) needs a hard reload, not hot-reload.
    _resolveLayout(key, layout) {
        if (layout !== 'auto') return layout;

        if (!this._pipelineLayouts[key]) {
            const { device } = this.gpu;
            const descriptors = makeBindGroupLayoutDescriptors(this.defs, {
                compute: { entryPoint: key },
            });
            const bindGroupLayouts = descriptors.map((d) => device.createBindGroupLayout(d));
            this._bindGroupLayouts[key] = bindGroupLayouts;
            this._pipelineLayouts[key] = device.createPipelineLayout({ bindGroupLayouts });
        }

        return this._pipelineLayouts[key];
    }

    // Hot-reload entry point. Callers that cached a kernel pipeline value (or
    // a bind group built from its layout) won't pick up the new pipeline —
    // re-read kernels[name] / recreate the bind group after a reload if the
    // compute is driven from a persistent update.
    reload(code) {
        try {
            this.build(code);
            console.log(`[hot] reloaded compute shader '${this.label}'`);
        } catch (e) {
            console.error(`[hot] failed to reload compute shader '${this.label}'`, e);
        }
    }

    isValidKernel(key) {
        let keys = [];
        const { entryPoints } = this.defs;
        for (let _key in entryPoints) keys.push(_key);
        return keys.indexOf(key) > -1.0;
    }

    findKernel(key) {
        if (!this.isValidKernel(key)) {
            console.error(`kernel ${key} not found`);
            return;
        }

        return this.kernels[key];
    }

    // Returns the persistent, hot-reload-stable bind group layout for a kernel's
    // group index. The caller builds its own GPUBindGroup against it and passes
    // that to dispatch — ComputeShader owns the pipeline + layout, never the bind
    // group (mirrors RenderPipeline.bindGroupLayout). Accepts the kernel object
    // (uses its label) or the entry-point name string.
    bindGroupLayout(kernelOrKey, groupIndex = 0) {
        const key = typeof kernelOrKey === 'string' ? kernelOrKey : kernelOrKey.label;
        // Ensure the explicit layout is built/persisted (no-op for non-'auto').
        this._resolveLayout(key, this._buildOpts.layout);
        // Prefer the persistent explicit BGL (stable across reloads); fall back
        // to the pipeline's own layout for the non-'auto' case.
        return this._bindGroupLayouts[key]?.[groupIndex] ?? this.kernels[key].getBindGroupLayout(groupIndex);
    }

    async dispatch(encoder, { pass = null, kernel, bindGroup, bindGroupIndex = 0, dispatchCount, workgroupBuffer = null, timing = false } = {}) {
        if (!encoder) {
            console.error('no enconder found');
            return;
        }

        if (!kernel) {
            console.error(`no kernel for ${this.label} found`);
            return;
        }

        if (!bindGroup) {
            console.error('no bind group found');
            return;
        }

        if (!dispatchCount || dispatchCount.length < 0) {
            console.error('no valid dispatch count passed');
            return;
        }

        const _pass = pass
            ? pass
            : timing
              ? encoder.beginComputePass({
                    label: kernel.label,
                    timestampWrites: {
                        querySet: this.querySet,
                        beginningOfPassWriteIndex: 0,
                        endOfPassWriteIndex: 1,
                    },
                })
              : encoder.beginComputePass({ label: kernel.label });
        _pass.setPipeline(kernel);
        _pass.setBindGroup(bindGroupIndex, bindGroup);
        if (workgroupBuffer) {
            console.log('dispatching with workgroup buffer');
            _pass.dispatchWorkgroupsIndirect(workgroupBuffer, 0);
        } else {
            _pass.dispatchWorkgroups(...dispatchCount);
        }

        if (!pass) _pass.end();

        if (timing) {
            encoder.resolveQuerySet(this.querySet, 0, 2, this.queryBuffer, 0);
            encoder.copyBufferToBuffer(this.queryBuffer, 0, this.queryBufferResult, 0, this.queryBufferResult.size);
        }
    }

    getTiming = async () => {
        await this.queryBufferResult.mapAsync(GPUMapMode.READ);
        const data = new BigInt64Array(this.queryBufferResult.getMappedRange());
        const timing = data[1] - data[0];
        console.log('potential time: ' + Number(timing) / 1000000);
        console.log(data);
        this.queryBufferResult.unmap();
    };
}
