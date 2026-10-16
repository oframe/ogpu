import { Mat4 } from '@math';
import { NEEDS_NORMAL, NEEDS_OBJECT } from './Shader.js';

// PerDrawBuffer: where the engine keeps the uniforms every Mesh shader reads
// (camera, object, time in engine.wgsl).
//
// One GPU buffer cut into equal slots. A mesh gets a slot on its first draw and
// keeps it; each render() gets a camera slot; slot 0 holds the time. A draw
// only points group(1) at its camera and object slots (dynamic offsets), so
// nothing is allocated per draw.
//
// Writes go to a CPU copy and mark the slot dirty; render() uploads the dirty
// slots once, before the submit. An object slot is rewritten only when its mesh
// moved (or its shader reads more), so a static mesh costs no upload at all.
//
// Reading order: the idea (writeObject, writeCamera, writeTime, flush), then
// the hardening, each section opening with the problem it solves.

// Engine block sizes (src/core/engine.wgsl). Float offsets inside each block:
export const CAMERA_SIZE = 176;
export const OBJECT_SIZE = 176;
export const TIME_SIZE = 8; // time, delta (group(3), bound with size TIME_BINDING_SIZE)
export const TIME_BINDING_SIZE = 16;
const PROJECTION = 0, VIEW = 16, CAMERA_POSITION = 32, CAMERA_QUATERNION = 36, VIEWPORT = 40; // prettier-ignore
const MODEL = 0, NORMAL = 16, OBJECT = 28; // prettier-ignore

const IDENTITY = /* @__PURE__ */ new Mat4();

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

        // dirty slots: a flag per slot, their count and their [lo, hi] span
        this._dirty = new Uint8Array(this.capacity);
        this._dirtyCount = 0;
        this._dirtyLo = Infinity;
        this._dirtyHi = -1;

        // slot lifetime
        this._next = 0; // slots below this have been handed out
        this._free = [];
        this._released = []; // reusable after the next reset()
        // meshes dropped without destroy() give their slot back when collected
        this._registry = new FinalizationRegistry((slot) => this._release(slot));

        // camera slots: the frame's Nth render() takes the Nth
        this._cameraSlots = [];
        this._cameraIndex = 0;

        // bumped when `buffer` is replaced (growth): bind groups over the old one
        // are stale
        this.bufferVersion = 0;
        this._retired = [];
        // bumped at each frame start and after each renderer-owned submit; two
        // writes of one slot with the same submitIndex reach the GPU as one
        this.submitIndex = 0;

        // slot 0, never released (acquired last: everything _acquire touches is set)
        this.timeOffset = this._acquire() * this.stride;
    }

    // ── The idea ─────────────────────────────────────────────────────────────

    // `mesh`'s object block; returns its dynamic offset. The slot is rewritten
    // only when the world matrix moved or the shader reads more than the slot
    // holds; normalMatrix/objectMatrix are written only when the shader reads them.
    //
    // The mesh keeps its slot record on `mesh._perDrawSlot`:
    //   { owner, index, worldVersion, needs, submit }
    writeObject(mesh) {
        const needs = mesh.shader.needs;
        let s = mesh._perDrawSlot;
        let keep = 0; // needs bits the slot already holds for this world matrix
        if (s?.owner === this) {
            const moved = s.worldVersion !== mesh.worldVersion;
            if (!moved && !(needs & ~s.needs)) return s.index * this.stride;
            if (!moved) keep = s.needs;
            else if (s.submit === this.submitIndex) this._warnRewrite(mesh);
        } else {
            s = this._claim(mesh);
        }
        mesh.updateDerived(needs);
        const o = (s.index * this.stride) >> 2;
        const f = this.f32;
        f.set(mesh.worldMatrix, o + MODEL);
        if (needs & NEEDS_NORMAL) f.set(mesh.normalMatrix, o + NORMAL);
        if (needs & NEEDS_OBJECT) f.set(mesh.objectMatrix, o + OBJECT);
        s.worldVersion = mesh.worldVersion;
        s.needs = keep | needs;
        s.submit = this.submitIndex;
        this._mark(s.index);
        return s.index * this.stride;
    }

    // Camera block in the frame's next camera slot; returns its dynamic offset.
    // A null camera (e.g. a render() with no camera) writes identity matrices.
    writeCamera(camera, width, height) {
        let slot = this._cameraSlots[this._cameraIndex];
        if (slot === undefined) slot = this._newCameraSlot();
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

    // Time block (time, delta) for group(3), bound at timeOffset; marked only
    // when a value changed, so further render()s in a frame upload nothing for
    // it. Slot 0 sits next to the frame's first camera slot, so one flush span
    // normally carries both.
    writeTime(time, delta) {
        const o = this.timeOffset >> 2;
        const f = this.f32;
        if (f[o] === Math.fround(time) && f[o + 1] === Math.fround(delta)) return;
        f[o] = time;
        f[o + 1] = delta;
        this._mark(this.timeOffset / this.stride);
    }

    // Upload the dirty slots: one writeBuffer over the [lo, hi] span, unless it
    // is mostly clean (see "upload strategy" below).
    flush() {
        const n = this._dirtyCount;
        if (!n) return;
        const lo = this._dirtyLo;
        const hi = this._dirtyHi;
        if (hi - lo + 1 <= n * FULL_SPAN_RATIO) {
            const stride = this.stride;
            this.gpu.device.queue.writeBuffer(this.buffer, lo * stride, this.mirror, lo * stride, (hi - lo + 1) * stride);
            this._dirty.fill(0, lo, hi + 1);
        } else {
            this._flushRuns(lo, hi);
        }
        this._dirtyCount = 0;
        this._dirtyLo = Infinity;
        this._dirtyHi = -1;
    }

    _mark(slot) {
        if (this._dirty[slot]) return;
        this._dirty[slot] = 1;
        this._dirtyCount++;
        if (slot < this._dirtyLo) this._dirtyLo = slot;
        if (slot > this._dirtyHi) this._dirtyHi = slot;
    }

    // Uploads queued since the last flush, if any (a draw outside render()).
    get pending() {
        return this._dirtyCount;
    }

    // ── Hardening: upload strategy ───────────────────────────────────────────
    //
    // One mesh moving at slot 1500 next to the camera at slot 1 would upload
    // 1500 clean slots as one span. Past FULL_SPAN_RATIO x the dirty count,
    // flush uploads each contiguous dirty run instead (ratio measured, below).

    _flushRuns(lo, hi) {
        const stride = this.stride;
        const queue = this.gpu.device.queue;
        const dirty = this._dirty;
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

    // ── Hardening: slot lifetime ─────────────────────────────────────────────
    //
    // A slot belongs to its mesh until the mesh is destroyed, or collected when
    // dropped without destroy(). Not "unseen for N frames": a hidden mesh keeps
    // its slot, since a recorded bundle bakes the offset. A released slot is
    // reused only after the next reset(): an encoded, unsubmitted draw may still
    // read it.

    // first draw on this buffer, a draw after destroy(), or the mesh's last slot
    // belonged to another buffer (e.g. before a device restore)
    _claim(mesh) {
        let s = mesh._perDrawSlot;
        s?.owner?.release(mesh);
        if (!s) s = mesh._perDrawSlot = { owner: null, index: -1, worldVersion: -1, needs: 0, submit: -1 };
        s.index = this._acquire();
        s.owner = this;
        this._registry.register(mesh, s.index, mesh);
        return s;
    }

    _acquire() {
        if (this._free.length) return this._free.pop();
        if (this._next === this.capacity) this._grow(this.capacity * 2);
        return this._next++;
    }

    // Give `mesh`'s slot back (Mesh.destroy calls this).
    release(mesh) {
        const s = mesh._perDrawSlot;
        if (s?.owner !== this) return;
        this._registry.unregister(mesh);
        this._release(s.index);
        s.owner = null;
    }

    _release(slot) {
        this._released.push(slot);
    }

    _newCameraSlot() {
        const slot = (this._cameraSlots[this._cameraIndex] = this._acquire());
        if (this._cameraIndex === 1024) {
            console.warn('[per-draw] 1024 render() calls without a frame boundary — call renderer.perDraw.reset() once per frame when driving render() outside Renderer.update');
        }
        return slot;
    }

    // Frame boundary (Renderer.update): camera slots restart, released slots
    // become reusable, retired buffers go.
    reset() {
        this._cameraIndex = 0;
        if (this._released.length) {
            for (const s of this._released) this._free.push(s);
            this._released.length = 0;
        }
        this.submitIndex++;
        for (const b of this._retired) b.destroy();
        this._retired.length = 0;
    }

    // ── Hardening: running out of slots ──────────────────────────────────────
    //
    // The buffer doubles. Draws already encoded keep reading the old buffer, so
    // its pending slots are uploaded there first, and it's destroyed at the next
    // frame start (after the submit that used it). `buffer` and `bufferVersion`
    // change: the renderer rebuilds its engine and time bind groups, and recorded
    // bundles (keyed on the buffer) re-encode.

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
        this.bufferVersion++;
        // the new buffer starts empty: everything handed out so far goes up
        if (this._next) this._markRange(0, this._next - 1);
    }

    _markRange(lo, hi) {
        for (let s = lo; s <= hi; s++) this._mark(s);
    }

    _createBuffer(size) {
        return this.gpu.device.createBuffer({
            label: this.label,
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    // ── Hardening: one value per slot per submit ─────────────────────────────
    //
    // Writes go to the mirror and upload before the submit, so a mesh drawn
    // twice in one external-encoder chain with a different transform in between
    // shows the last one in both passes. Self-submitting render()s are fine:
    // queue order separates them. Warned once per buffer.

    _warnRewrite(mesh) {
        if (this._rewriteWarned) return;
        this._rewriteWarned = true;
        console.warn(
            `[per-draw] mesh '${mesh.label}' moved between two passes of one submit — both passes see the last transform (or render() runs outside Renderer.update without perDraw.reset() per frame)`
        );
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
