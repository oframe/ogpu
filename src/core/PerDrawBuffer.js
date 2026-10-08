// Shared per-draw uniform buffer (Unity's UnityPerDraw analogue): every Mesh
// draw copies its uniforms into an aligned slice of a CPU mirror and records the
// slice offset via setBindGroup dynamic offsets. Renderer.render flushes the
// slices it allocated in ONE writeBuffer; Renderer owns one and resets the
// pointer each frame. Queue ordering makes flush-before-submit and cross-frame
// reuse safe.
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
        this.mirror = new Uint8Array(size);
        this.pointer = 0;
        // bytes already uploaded this frame; [flushed, pointer) is pending
        this.flushed = 0;
    }

    // next aligned slice; caller writes its uniforms at the returned offset
    alloc(byteLength) {
        const offset = this.pointer;
        this.pointer += Math.ceil(byteLength / this.align) * this.align;
        // No growth — growing invalidates every group(0); raise the
        // renderer's perDrawSize instead if this ever fires. Reported once per
        // frame: this runs per draw and would otherwise flood the console.
        if (this.pointer > this.size && !this._overflowReported) {
            this._overflowReported = true;
            console.error(`per-draw uniform buffer overflow (${this.pointer} > ${this.size}) — raise Renderer's perDrawSize; draws past the end are skipped`);
        }
        return offset;
    }

    // alloc + copy `bytes` (a Uint8Array) into the mirror; returns the dynamic
    // offset, or -1 when the slice doesn't fit — binding it would invalidate the pass
    write(bytes) {
        const offset = this.alloc(bytes.byteLength);
        if (offset + bytes.byteLength > this.size) return -1;
        this.mirror.set(bytes, offset);
        return offset;
    }

    // upload every slice allocated since the last flush in one writeBuffer
    flush() {
        const end = Math.min(this.pointer, this.size);
        if (end <= this.flushed) return;
        this.gpu.device.queue.writeBuffer(this.buffer, this.flushed, this.mirror, this.flushed, end - this.flushed);
        this.flushed = end;
    }

    reset() {
        this.pointer = 0;
        this.flushed = 0;
        this._overflowReported = false;
    }
}
