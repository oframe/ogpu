import { reflect, bindGroupLayoutDescriptors } from './reflect/index.js';
import { internBindGroupLayout, wrapBindGroupLayout, declaredBindings } from './BindGroupLayout.js';
import { registerShader } from './ShaderReload';
import { applyOverrideConstants } from '@utils/wgslOverrides';

// Wraps a compute module: one pipeline per entry point, keyed by name in this.kernels.
export class ComputeShader {
    constructor(gpu, { label = '', code = ``, layout = 'auto', constants = {}, size = 0 } = {}) {
        if (!gpu) throw new Error(`[compute-shader ${label}] no webgpu context (gpu) provided`);

        this.label = label;
        this.gpu = gpu;

        const { device } = this.gpu;

        // kernels object reference stays stable across reloads; only its
        // pipeline values get swapped. Callers should read kernels[name]
        // (or findKernel) at dispatch time rather than caching the value.
        this.kernels = {};

        // stash for hot-reload rebuilds (see ShaderReload.js)
        this._buildOpts = { layout, constants };

        // per build, entry-point name -> BindGroupLayout[] (sparse, by group)
        this._layouts = {};

        try {
            this.build(code);
        } catch (e) {
            throw new Error(`[compute-shader ${label}] shader build failed: ${e.message}`, { cause: e });
        }
        this._unregister = registerShader(this);

        // Spec throws a TypeError creating a 'timestamp' query set without the
        // feature enabled — gate like TimingHelper does.
        if (device.features.has('timestamp-query')) {
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

        this.defs = reflect(bakedCode);

        const { entryPoints } = this.defs;

        for (const key in this.kernels) delete this.kernels[key];
        this._layouts = {};

        for (let key in entryPoints) {
            this.kernels[key] = this.gpu.device.createComputePipeline({
                label: key,
                layout: layout === 'auto' ? this._pipelineLayout(key) : layout,
                compute: {
                    module: this.module,
                    entryPoint: key,
                },
            });
        }
    }

    // For layout:'auto', an explicit pipeline layout per entry point (an 'auto'
    // layout is tied to its pipeline; bind groups built against it break on the
    // next reload). Its BindGroupLayouts hold only what this entry point uses and
    // are interned by shape, so a reload that keeps the shape returns the same
    // objects and bind groups built from them stay valid.
    _pipelineLayout(key) {
        const { device } = this.gpu;
        const descriptors = bindGroupLayoutDescriptors(this.defs, [key]);
        const layouts = descriptors.map((d, i) => internBindGroupLayout(device, this.defs, i, d.entries, `${this.label}-${key}`, [key]));
        this._layouts[key] = layouts;
        return device.createPipelineLayout({ label: `${this.label}-${key}-layout`, bindGroupLayouts: layouts.map((l) => l.layout) });
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

    // The BindGroupLayout of one kernel's group — both arguments required:
    // bindGroupLayout('simulate', 0).createBindGroup({ … }). The caller owns the
    // bind group and passes it to dispatch. With a caller-supplied `layout` it
    // wraps that pipeline's raw layout (not interned), naming every binding the
    // module declares in the group, since an explicit layout usually spans kernels.
    bindGroupLayout(kernel, group) {
        if (typeof kernel !== 'string' || !Number.isInteger(group)) {
            throw new Error(`[compute ${this.label}] bindGroupLayout(kernel, group) needs a kernel name and a group index`);
        }
        if (!Object.hasOwn(this.kernels, kernel)) {
            throw new Error(`[compute ${this.label}] no kernel '${kernel}' — kernels: ${Object.keys(this.kernels).join(', ')}`);
        }
        const layouts = (this._layouts[kernel] ??= []);
        // caller-supplied pipeline layout: wrap lazily, cached until the next build
        if (!layouts[group] && this._buildOpts.layout !== 'auto' && declaredBindings(this.defs, group).length) {
            layouts[group] = wrapBindGroupLayout(this.gpu.device, this.kernels[kernel].getBindGroupLayout(group), this.defs, group, `${this.label}-${kernel}`);
        }
        const layout = layouts[group];
        if (!layout) throw new Error(`[compute ${this.label}] kernel '${kernel}' has no group(${group})`);
        return layout;
    }

    dispatch(encoder, { pass = null, kernel, bindGroup, bindGroupIndex = 0, dispatchCount, workgroupBuffer = null, timing = false } = {}) {
        if (!encoder) {
            console.error('no encoder found');
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

        if (!dispatchCount || dispatchCount.length < 1) {
            console.error('no valid dispatch count passed');
            return;
        }

        // timestamps only wrap a pass this method itself creates
        const canTime = timing && !!this.querySet && !pass;

        const _pass = pass
            ? pass
            : canTime
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
            _pass.dispatchWorkgroupsIndirect(workgroupBuffer, 0);
        } else {
            _pass.dispatchWorkgroups(...dispatchCount);
        }

        if (!pass) _pass.end();

        if (canTime) {
            encoder.resolveQuerySet(this.querySet, 0, 2, this.queryBuffer, 0);
            encoder.copyBufferToBuffer(this.queryBuffer, 0, this.queryBufferResult, 0, this.queryBufferResult.size);
        }
    }

    // Releases the timestamp-query resources and drops out of the hot-reload
    // registry. Pipelines/layouts have no destroy in WebGPU — refs just drop.
    destroy() {
        this._unregister?.();
        this.querySet?.destroy();
        this.queryBuffer?.destroy();
        this.queryBufferResult?.destroy();
        this.querySet = this.queryBuffer = this.queryBufferResult = null;
    }

    getTiming = async () => {
        if (!this.queryBufferResult) return;
        await this.queryBufferResult.mapAsync(GPUMapMode.READ);
        const data = new BigInt64Array(this.queryBufferResult.getMappedRange());
        const timing = data[1] - data[0];
        console.log('potential time: ' + Number(timing) / 1000000);
        console.log(data);
        this.queryBufferResult.unmap();
    };
}
