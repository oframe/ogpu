import { Mat4 } from '@math';

// Engine block sizes (src/core/engine.wgsl). Float offsets inside each block:
export const CAMERA_SIZE = 176;
export const OBJECT_SIZE = 240;
const PROJECTION = 0, VIEW = 16, CAMERA_POSITION = 32, TIME = 35, CAMERA_QUATERNION = 36, RESOLUTION = 40; // prettier-ignore
const MODEL = 0, MODEL_VIEW = 16, NORMAL = 32, OBJECT = 44; // prettier-ignore

const IDENTITY = /* @__PURE__ */ new Mat4();
const _modelView = /* @__PURE__ */ new Mat4(); // one scratch for every mesh, consumed immediately

// Shared per-draw uniform buffer (Unity's UnityPerDraw analogue) behind the
// engine's group(1): one camera slice per render() pass and one object slice per
// draw, in an aligned CPU mirror, bound through dynamic offsets. Legacy meshes
// copy their whole uniforms struct into a slice via write(). Renderer.render
// flushes the slices it allocated in ONE writeBuffer; Renderer owns one and
// resets the pointer each frame. Queue ordering makes flush-before-submit and
// cross-frame reuse safe.
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
        this.f32 = new Float32Array(this.mirror.buffer);
        this.pointer = 0;
        // bytes already uploaded this frame; [flushed, pointer) is pending
        this.flushed = 0;
    }

    // next aligned slice; caller writes its uniforms at the returned offset
    alloc(byteLength) {
        const offset = this.pointer;
        this.pointer += Math.ceil(byteLength / this.align) * this.align;
        // No growth — growing invalidates the engine bind group (and legacy
        // group(0)s); raise the renderer's perDrawSize instead if this ever
        // fires. Reported once per frame: this runs per draw and would
        // otherwise flood the console.
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

    // Camera block; returns its dynamic offset or -1. A null camera (e.g. a
    // render() with no camera) writes identity matrices.
    writeCamera(camera, time, width, height) {
        const offset = this.alloc(CAMERA_SIZE);
        if (offset + CAMERA_SIZE > this.size) return -1;
        const o = offset >> 2;
        const f = this.f32;
        f.fill(0, o, o + (CAMERA_SIZE >> 2));
        if (camera) {
            f.set(camera.projectionMatrix, o + PROJECTION);
            f.set(camera.viewMatrix, o + VIEW);
            f.set(camera.worldPosition, o + CAMERA_POSITION);
            f.set(camera.worldQuaternion ?? camera.quaternion, o + CAMERA_QUATERNION);
        } else {
            f.set(IDENTITY, o + PROJECTION);
            f.set(IDENTITY, o + VIEW);
            f[o + CAMERA_QUATERNION + 3] = 1;
        }
        f[o + TIME] = time;
        f[o + RESOLUTION] = width;
        f[o + RESOLUTION + 1] = height;
        return offset;
    }

    // Object block for `mesh` (normalMatrix/objectMatrix already current, see
    // Mesh.updateDerived); modelView goes through one scratch matrix.
    writeObject(mesh, camera) {
        const offset = this.alloc(OBJECT_SIZE);
        if (offset + OBJECT_SIZE > this.size) return -1;
        const o = offset >> 2;
        const f = this.f32;
        const world = mesh.worldMatrix;
        f.set(world, o + MODEL);
        f.set(camera ? _modelView.copy(camera.viewMatrix).multiply(world) : world, o + MODEL_VIEW);
        f.set(mesh.normalMatrix, o + NORMAL);
        f.set(mesh.objectMatrix, o + OBJECT);
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
