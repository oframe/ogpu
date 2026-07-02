import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';
import { Vec3 } from '@math';
import { Raycast } from '../Raycast.js';
import { Pointer } from './Pointer.js';

gsap.registerPlugin(Observer);

const DRAG_TYPES = ['dragstart', 'drag', 'dragend'];

/**
 * Unified mouse/touch interaction for meshes: hover enter/leave/move, click
 * (with travel slop), and drag with world-plane projection. Input runs
 * through gsap's Observer (velocity tracking included); picking through the
 * engine's Raycast. The manager only *emits* — moving meshes is the
 * listener's job.
 *
 *   const im = new InteractionManager({ renderer, camera });
 *   im.on(mesh, 'click', ({ mesh, hit, pointer }) => { ... });
 *   im.on(mesh, 'drag', ({ point, worldDelta }) => mesh.position.copy(point));
 *
 * Payloads carry the live `mesh.hit` object — copy what you keep.
 */
export class InteractionManager {
    constructor({ renderer, camera, targets = [], clickSlop = 6, dragPlaneNormal = 'up', cursor = true, preventDefault = false } = {}) {
        this.renderer = renderer;
        this.camera = camera;
        this.targets = [...targets];
        this.clickSlop = clickSlop;
        this.cursor = cursor;
        this.enabled = true;

        this.pointer = new Pointer();
        this.raycast = new Raycast();

        this.hovered = null;
        this.pressed = null;
        this.dragging = null;

        this._listeners = new Map();
        this._element = renderer.canvas;

        // 'up' (floor drags), 'screen' (camera-facing), or a fixed Vec3
        this.dragPlaneNormal = dragPlaneNormal;
        this._plane = { origin: new Vec3(), normal: new Vec3(0, 1, 0) };
        this._dragPoint = new Vec3();
        this._lastDragPoint = new Vec3();
        this._worldDelta = new Vec3();

        this.observer = Observer.create({
            target: this._element,
            type: 'pointer,touch',
            preventDefault,
            onPress: (self) => this._press(self),
            onRelease: (self) => this._release(self),
            onMove: (self) => this._move(self),
            onDrag: (self) => this._move(self),
        });

        this._updateCb = () => this.update();
        renderer.add(this._updateCb);
    }

    /** Listen on a mesh. Registers it as a pick target. Returns unsubscribe. */
    on(mesh, type, cb) {
        if (!this._listeners.has(mesh)) {
            this._listeners.set(mesh, new Map());
            if (!this.targets.includes(mesh)) this.targets.push(mesh);
        }
        const byType = this._listeners.get(mesh);
        if (!byType.has(type)) byType.set(type, new Set());
        byType.get(type).add(cb);
        return () => byType.get(type)?.delete(cb);
    }

    off(mesh) {
        this._listeners.delete(mesh);
        const i = this.targets.indexOf(mesh);
        if (i !== -1) this.targets.splice(i, 1);
    }

    _emit(mesh, type, extra = {}) {
        const cbs = this._listeners.get(mesh)?.get(type);
        if (!cbs) return;
        const payload = { mesh, hit: mesh.hit, pointer: this.pointer, ...extra };
        cbs.forEach((cb) => cb?.(payload));
    }

    _hasDragListeners(mesh) {
        const byType = this._listeners.get(mesh);
        return !!byType && DRAG_TYPES.some((t) => byType.get(t)?.size);
    }

    _syncPointer(self) {
        const rect = this._element.getBoundingClientRect();
        const p = this.pointer;
        p.delta.set(self.deltaX, self.deltaY);
        p.position.set(self.x - rect.left, self.y - rect.top);
        p.velocity.set(self.velocityX, self.velocityY);
        p._updateNdc(this._element);
        p.inside = true;
    }

    _press(self) {
        this._syncPointer(self);
        const p = this.pointer;
        p.isDown = true;
        p.downPosition.copy(p.position);

        this._pick();
        this.pressed = this.hovered;
        if (this.pressed) this._emit(this.pressed, 'down');
    }

    _move(self) {
        this._syncPointer(self);
        const p = this.pointer;

        if (p.isDown && !this.dragging && this.pressed && this._hasDragListeners(this.pressed) && p.travel > this.clickSlop) {
            this._startDrag();
        }
    }

    _release(self) {
        this._syncPointer(self);
        const p = this.pointer;

        if (this.dragging) {
            const mesh = this.dragging;
            this.dragging = null;
            p.isDragging = false;
            this._emit(mesh, 'dragend', { point: this._dragPoint, velocity: p.velocity });
        } else if (this.pressed && this.hovered === this.pressed && p.travel <= this.clickSlop) {
            this._emit(this.pressed, 'click');
        }

        if (this.pressed) this._emit(this.pressed, 'up');
        this.pressed = null;
        p.isDown = false;
    }

    _startDrag() {
        const mesh = this.pressed;
        this.dragging = mesh;
        this.pointer.isDragging = true;

        // drag plane through the grab point
        this._plane.origin.copy(mesh.hit?.point ?? mesh.worldMatrix.getTranslation(this._dragPoint));
        if (this.dragPlaneNormal === 'screen') {
            const m = this.camera.worldMatrix;
            this._plane.normal.set(m[8], m[9], m[10]).normalize();
        } else if (this.dragPlaneNormal === 'up') {
            this._plane.normal.set(0, 1, 0);
        } else {
            this._plane.normal.copy(this.dragPlaneNormal).normalize();
        }

        this.raycast.castMouse(this.camera, this.pointer.ndc);
        this.raycast.intersectPlane(this._plane, undefined, undefined, this._lastDragPoint);
        this._emit(mesh, 'dragstart', { point: this._lastDragPoint });
    }

    _pick() {
        this.raycast.castMouse(this.camera, this.pointer.ndc);
        const hits = this.raycast.intersectMeshes(this.targets);
        const top = hits.length ? hits[0] : null;

        if (top !== this.hovered) {
            if (this.hovered) this._emit(this.hovered, 'leave');
            this.hovered = top;
            if (top) this._emit(top, 'enter');
            if (this.cursor) this._element.style.cursor = top ? 'pointer' : '';
        } else if (top) {
            this._emit(top, 'move');
        }
    }

    update() {
        if (!this.enabled || !this.camera) return;

        if (this.dragging) {
            this.raycast.castMouse(this.camera, this.pointer.ndc);
            if (this.raycast.intersectPlane(this._plane, undefined, undefined, this._dragPoint)) {
                this._worldDelta.copy(this._dragPoint).sub(this._lastDragPoint);
                this._emit(this.dragging, 'drag', { point: this._dragPoint, worldDelta: this._worldDelta });
                this._lastDragPoint.copy(this._dragPoint);
            }
            if (this.cursor) this._element.style.cursor = 'grabbing';
            return;
        }

        this._pick();
    }

    dispose() {
        this.observer.kill();
        this.renderer.remove(this._updateCb);
        if (this.cursor) this._element.style.cursor = '';
        this._listeners.clear();
        this.targets.length = 0;
    }
}
