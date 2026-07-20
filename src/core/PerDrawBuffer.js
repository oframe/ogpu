// Shared per-draw uniform buffer (Unity's UnityPerDraw analogue): every Mesh
// draw allocates an aligned slice, writes its uniforms there, and records the
// slice offset via setBindGroup dynamic offsets. Renderer owns one and resets
// the pointer each frame; queue ordering makes cross-frame reuse safe.
export class PerDrawBuffer {
    constructor(gpu, { label = 'per-draw-uniforms', size = 1 << 20 } = {}) {
        this.gpu = gpu;
        this.size = size;
        this.align = gpu.device.limits.minUniformBufferOffsetAlignment;
        this.buffer = gpu.device.createBuffer({
            label,
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.pointer = 0;
    }

    // next aligned slice; caller writes its uniforms at the returned offset
    alloc(byteLength) {
        const offset = this.pointer;
        this.pointer += Math.ceil(byteLength / this.align) * this.align;
        // No growth — growing invalidates every group(0); raise the
        // renderer's perDrawSize instead if this ever fires.
        if (this.pointer > this.size) {
            console.error(`per-draw uniform buffer overflow (${this.pointer} > ${this.size}) — raise Renderer's perDrawSize`);
        }
        return offset;
    }

    reset() {
        this.pointer = 0;
    }
}
