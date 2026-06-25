import { mat4, quat } from 'wgpu-matrix';
import { compose, decompose } from '@utils/Mat4Utils';

/**
 * 4x4 column-major matrix. Subclasses Float32Array for drop-in
 * wgpu-matrix interop plus a chainable three.js-style API.
 * Defaults to identity.
 */
export class Mat4 extends Float32Array {
    constructor() {
        super(16);
        mat4.identity(this);
    }

    set(...values) {
        if (values.length === 1 && typeof values[0] === 'object') {
            super.set(values[0], values[1] || 0);
            return this;
        }
        for (let i = 0; i < 16; i++) this[i] = values[i];
        return this;
    }

    copy(m) {
        mat4.copy(m, this);
        return this;
    }

    clone() {
        return new Mat4().copy(this);
    }

    identity() {
        mat4.identity(this);
        return this;
    }

    multiply(m) {
        mat4.multiply(this, m, this);
        return this;
    }

    premultiply(m) {
        mat4.multiply(m, this, this);
        return this;
    }

    invert() {
        mat4.inverse(this, this);
        return this;
    }

    transpose() {
        mat4.transpose(this, this);
        return this;
    }

    fromQuat(q) {
        mat4.fromQuat(q, this);
        return this;
    }

    /** Build from translation / rotation (quat) / scale. */
    compose(position, quaternion, scale) {
        compose(this, quaternion, position, scale);
        return this;
    }

    /** Extract translation / rotation (quat) / scale into the passed targets. */
    decompose(position, quaternion, scale) {
        decompose(this, quaternion, position, scale);
        return this;
    }

    scale(v) {
        mat4.scale(this, v, this);
        return this;
    }

    translate(v) {
        mat4.translate(this, v, this);
        return this;
    }

    rotateX(angle) {
        mat4.rotateX(this, angle, this);
        return this;
    }

    rotateY(angle) {
        mat4.rotateY(this, angle, this);
        return this;
    }

    rotateZ(angle) {
        mat4.rotateZ(this, angle, this);
        return this;
    }

    perspective(fovy, aspect, near, far) {
        mat4.perspective(fovy, aspect, near, far, this);
        return this;
    }

    ortho(left, right, bottom, top, near, far) {
        mat4.ortho(left, right, bottom, top, near, far, this);
        return this;
    }

    lookAt(eye, target, up) {
        mat4.lookAt(eye, target, up, this);
        return this;
    }

    /**
     * Object-orientation matrix: +Z aimed from `eye` toward `target`.
     * This is the inverse-handed counterpart to `lookAt` (which builds a
     * view matrix). Use for orienting a node, not a camera.
     */
    aim(eye, target, up) {
        mat4.aim(eye, target, up, this);
        return this;
    }

    determinant() {
        return mat4.determinant(this);
    }

    getTranslation(out) {
        return mat4.getTranslation(this, out);
    }

    getScale(out) {
        return mat4.getScaling(this, out);
    }

    getRotation(out) {
        return quat.fromMat(this, out);
    }

    getAxis(axis, out) {
        return mat4.getAxis(this, axis, out);
    }

    // Largest per-axis scale factor — bounds how much this matrix can grow a
    // length (used to scale bounding-sphere radii into world space).
    getMaxScaleOnAxis() {
        const sx = this[0] * this[0] + this[1] * this[1] + this[2] * this[2];
        const sy = this[4] * this[4] + this[5] * this[5] + this[6] * this[6];
        const sz = this[8] * this[8] + this[9] * this[9] + this[10] * this[10];
        return Math.sqrt(Math.max(sx, sy, sz));
    }

    fromArray(a, o = 0) {
        for (let i = 0; i < 16; i++) this[i] = a[o + i];
        return this;
    }

    toArray(a = [], o = 0) {
        for (let i = 0; i < 16; i++) a[o + i] = this[i];
        return a;
    }

    // alternate-name aliases
    inverse() {
        return this.invert();
    }
    fromQuaternion(q) {
        return this.fromQuat(q);
    }
}
