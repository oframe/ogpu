import { StructView } from './reflect/StructView.js';

// A struct view plus the GPUBuffer it uploads to. Knows no shader or pipeline:
// build it from any reflected struct (`shader.uniforms`, `pipeline.defs.uniforms.x`,
// `computeShader.defs.uniforms.x`) and bind it by name —
// `layout.createBindGroup({ uniforms: ub })`. `set()` writes the view and queues
// the upload immediately, so values are shared by every pass in a submit (last
// write wins); use one UniformBuffer per view for per-pass values. Several fields
// at once: write `ub.views.x`, then `ub.upload()`.
export class UniformBuffer {
    constructor(gpu, struct, values, { label = 'uniforms', usage = 0 } = {}) {
        if (!struct) throw new Error(`[uniform-buffer ${label}] no struct (shader declares no uniforms?)`);
        this.gpu = gpu;
        this.label = label;
        this.view = new StructView(struct);
        this.buffer = gpu.device.createBuffer({
            label,
            size: Math.max(16, this.view.arrayBuffer.byteLength),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | usage,
        });
        if (values) this.set(values);
        else this.upload();
    }

    // shorthand for this.view.views
    get views() {
        return this.view.views;
    }

    set(values) {
        this.view.set(values);
        return this.upload();
    }

    // after writing `views` directly
    upload() {
        this.gpu.device.queue.writeBuffer(this.buffer, 0, this.view.arrayBuffer);
        return this;
    }

    destroy() {
        this.buffer.destroy();
    }
}
