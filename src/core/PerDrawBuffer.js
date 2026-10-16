import { Mat4 } from '@math';
import { NEEDS_NORMAL, NEEDS_OBJECT } from './Shader.js';

// Engine block sizes (src/core/engine.wgsl). Float offsets inside each block:
export const CAMERA_SIZE = 176;
export const OBJECT_SIZE = 176;
const PROJECTION = 0, VIEW = 16, CAMERA_POSITION = 32, CAMERA_QUATERNION = 36, VIEWPORT = 40; // prettier-ignore
const MODEL = 0, NORMAL = 16, OBJECT = 28; // prettier-ignore

const IDENTITY = /* @__PURE__ */ new Mat4();

// Engine uniform buffer behind group(1), in fixed slots bound through dynamic
// offsets. Every mesh owns a permanent object slot from its first draw, rewritten
// only when its worldVersion (or its shader's needs) changes; camera slices take
// the frame's next camera slot per render(), so a stable setup sees stable
// offsets. Writes land in a CPU mirror; flush() uploads the dirty slots.
//
// A slot holds one value per submit: the same mesh drawn twice in one
// external-encoder chain with a different transform in between shows the last
// one in both passes (warned once).
export class PerDrawBuffer {
    constructor(gpu, { label = 'per-draw-uniforms', size = 1 << 20 } = {}) {
        this.gpu = gpu;
        this.label = label;
        this.align = gpu.device.limits.minUniformBufferOffsetAlignment;
        this.stride = Math.ceil(Math.max(CAMERA_SIZE, OBJECT_SIZE) / this.align) * this.align;
        this.capacity = Math.max(1, Math.floor(size / this.stride));
        this.size = this.capacity * this.stride;
        this.buffer = this._createBuffer(this.size);
        this.mirror = new Uint8Array(this.size);
        this.f32 = new Float32Array(this.mirror.buffer);
        // bumped when `buffer` is replaced (growth): bind groups built on the
        // old one are stale
        this.generation = 0;

        this._next = 0; // slots below this have been handed out
        this._free = [];
        // released this frame: an encoded-but-unsubmitted draw may still read
        // them, so they're reusable only after the next reset()
        this._released = [];
        this._dirty = new Uint8Array(this.capacity);
        this._dirtyCount = 0;
        this._dirtyLo = Infinity;
        this._dirtyHi = -1;
        this._cameraSlots = [];
        this._cameraIndex = 0;
        // bumped at each frame start and after each renderer-owned submit; two
        // writes of one slot inside an epoch would reach the GPU as one
        this.epoch = 0;
        this._retired = [];
        // meshes dropped without destroy() give their slot back when collected
        this._registry = new FinalizationRegistry((slot) => this._release(slot));
    }

    _createBuffer(size) {
        return this.gpu.device.createBuffer({
            label: this.label,
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    _acquire() {
        if (this._free.length) return this._free.pop();
        if (this._next === this.capacity) this._grow(this.capacity * 2);
        return this._next++;
    }

    _release(slot) {
        this._released.push(slot);
    }

    // Double the buffer. Draws already encoded keep reading the old buffer, so
    // its pending slices are uploaded there first; it's destroyed at the next
    // frame start (after the submit that used it).
    _grow(capacity) {
        this.flush();
        this._retired.push(this.buffer);
        const size = capacity * this.stride;
        const mirror = new Uint8Array(size);
        mirror.set(this.mirror);
        const dirty = new Uint8Array(capacity);
        dirty.set(this._dirty);
        this.capacity = capacity;
        this.size = size;
        this.mirror = mirror;
        this.f32 = new Float32Array(mirror.buffer);
        this._dirty = dirty;
        this.buffer = this._createBuffer(size);
        this.generation++;
        // the new buffer starts empty: everything handed out so far goes up
        if (this._next) this._markRange(0, this._next - 1);
    }

    _mark(slot) {
        if (this._dirty[slot]) return;
        this._dirty[slot] = 1;
        this._dirtyCount++;
        if (slot < this._dirtyLo) this._dirtyLo = slot;
        if (slot > this._dirtyHi) this._dirtyHi = slot;
    }

    _markRange(lo, hi) {
        for (let s = lo; s <= hi; s++) this._mark(s);
    }

    // Camera block in the frame's next camera slot; returns its dynamic offset.
    // A null camera (e.g. a render() with no camera) writes identity matrices.
    writeCamera(camera, width, height) {
        let slot = this._cameraSlots[this._cameraIndex];
        if (slot === undefined) {
            slot = this._cameraSlots[this._cameraIndex] = this._acquire();
            if (this._cameraIndex === 1024) {
                console.warn('[per-draw] 1024 render() calls without a frame boundary — call renderer.perDraw.reset() once per frame when driving render() outside Renderer.update');
            }
        }
        this._cameraIndex++;
        const offset = slot * this.stride;
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
        f[o + VIEWPORT] = width;
        f[o + VIEWPORT + 1] = height;
        this._mark(slot);
        return offset;
    }

    // `mesh`'s object slot (acquired on first use), rewritten only when its world
    // matrix or its shader's needs changed; returns the dynamic offset.
    // normalMatrix/objectMatrix are written only when the shader reads them.
    writeObject(mesh) {
        const needs = mesh.shader.needs;
        let keep = 0; // needs bits the slot already holds for this world matrix
        if (mesh._slotOwner === this) {
            const moved = mesh._slotVersion !== mesh.worldVersion;
            if (!moved && !(needs & ~mesh._slotNeeds)) return mesh._slot * this.stride;
            if (moved && mesh._slotEpoch === this.epoch && !this._rewriteWarned) {
                this._rewriteWarned = true;
                console.warn(
                    `[per-draw] mesh '${mesh.label}' moved between two passes of one submit — both passes see the last transform (or render() runs outside Renderer.update without perDraw.reset() per frame)`
                );
            }
            if (!moved) keep = mesh._slotNeeds;
        } else {
            mesh._slotOwner?.release(mesh); // another (or a pre-restore) buffer
            mesh._slot = this._acquire();
            mesh._slotOwner = this;
            this._registry.register(mesh, mesh._slot, mesh);
        }
        mesh.updateDerived(needs);
        const slot = mesh._slot;
        const o = (slot * this.stride) >> 2;
        const f = this.f32;
        f.set(mesh.worldMatrix, o + MODEL);
        if (needs & NEEDS_NORMAL) f.set(mesh.normalMatrix, o + NORMAL);
        if (needs & NEEDS_OBJECT) f.set(mesh.objectMatrix, o + OBJECT);
        mesh._slotVersion = mesh.worldVersion;
        mesh._slotNeeds = keep | needs;
        mesh._slotEpoch = this.epoch;
        this._mark(slot);
        return slot * this.stride;
    }

    // Give `mesh`'s slot back (Mesh.destroy calls this).
    release(mesh) {
        if (mesh._slotOwner !== this) return;
        this._registry.unregister(mesh);
        this._release(mesh._slot);
        mesh._slotOwner = null;
    }

    // Upload the dirty slots: one writeBuffer over [lo, hi] while the span is at
    // most FULL_SPAN_RATIO x the dirty count, else one per contiguous run.
    flush() {
        const n = this._dirtyCount;
        if (!n) return;
        const lo = this._dirtyLo;
        const hi = this._dirtyHi;
        const stride = this.stride;
        const queue = this.gpu.device.queue;
        const dirty = this._dirty;
        if (hi - lo + 1 <= n * FULL_SPAN_RATIO) {
            queue.writeBuffer(this.buffer, lo * stride, this.mirror, lo * stride, (hi - lo + 1) * stride);
            dirty.fill(0, lo, hi + 1);
        } else {
            let start = -1;
            for (let s = lo; s <= hi + 1; s++) {
                if (s <= hi && dirty[s]) {
                    dirty[s] = 0;
                    if (start < 0) start = s;
                } else if (start >= 0) {
                    queue.writeBuffer(this.buffer, start * stride, this.mirror, start * stride, (s - start) * stride);
                    start = -1;
                }
            }
        }
        this._dirtyCount = 0;
        this._dirtyLo = Infinity;
        this._dirtyHi = -1;
    }

    // Uploads queued since the last flush, if any (a draw outside render()).
    get pending() {
        return this._dirtyCount;
    }

    // Frame boundary (Renderer.update): camera slots restart, released slots
    // become reusable, retired buffers go.
    reset() {
        this._cameraIndex = 0;
        if (this._released.length) {
            for (const s of this._released) this._free.push(s);
            this._released.length = 0;
        }
        this.epoch++;
        for (const b of this._retired) b.destroy();
        this._retired.length = 0;
    }

    destroy() {
        this.buffer.destroy();
        for (const b of this._retired) b.destroy();
        this._retired.length = 0;
    }
}

// Measured (Chrome/Metal, 256 B slots): a writeBuffer call costs ~0.2 us of
// renderer CPU and ~0.75 us of GPU-process time, a byte of span ~0.33 us/KB.
// Per-run calls win on CPU past ~2.5x span/dirty, one span call wins on the
// GPU-process side up to ~9x; 4 splits the difference.
const FULL_SPAN_RATIO = 4;
