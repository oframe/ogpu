import { quat } from 'wgpu-matrix';

/**
 * Quaternion (x, y, z, w). Subclasses Float32Array for drop-in wgpu-matrix
 * interop plus a chainable three.js-style API.
 */
export class Quat extends Float32Array {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        super(4);
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this[3] = w;
        // Fired after any mutation. Transform wires this to keep `rotation`
        // (Euler) in sync. `setFromEuler` deliberately does NOT fire it — that
        // is the Euler→Quat direction and firing would loop. Default is a noop.
        this.onChange = () => {};
    }

    get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
        this.onChange();
    }
    get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
        this.onChange();
    }
    get z() {
        return this[2];
    }
    set z(v) {
        this[2] = v;
        this.onChange();
    }
    get w() {
        return this[3];
    }
    set w(v) {
        this[3] = v;
        this.onChange();
    }

    set(x, y, z, w) {
        if (typeof x === 'object' && x !== null) {
            super.set(x, y);
            this.onChange();
            return this;
        }
        this[0] = x;
        if (y !== undefined) this[1] = y;
        if (z !== undefined) this[2] = z;
        if (w !== undefined) this[3] = w;
        this.onChange();
        return this;
    }

    copy(q) {
        this[0] = q[0];
        this[1] = q[1];
        this[2] = q[2];
        this[3] = q[3];
        this.onChange();
        return this;
    }

    clone() {
        return new Quat(this[0], this[1], this[2], this[3]);
    }

    identity() {
        quat.identity(this);
        this.onChange();
        return this;
    }

    // Euler→Quat direction: intentionally does NOT fire onChange (would loop
    // against Transform's rotation sync).
    setFromEuler(x, y, z, order = 'xyz') {
        quat.fromEuler(x, y, z, order, this);
        return this;
    }

    setFromAxisAngle(axis, angle) {
        quat.fromAxisAngle(axis, angle, this);
        this.onChange();
        return this;
    }

    setFromRotationMatrix(m) {
        quat.fromMat(m, this);
        this.onChange();
        return this;
    }

    multiply(q) {
        quat.mul(this, q, this);
        this.onChange();
        return this;
    }

    premultiply(q) {
        quat.mul(q, this, this);
        this.onChange();
        return this;
    }

    rotateX(angle) {
        quat.rotateX(this, angle, this);
        this.onChange();
        return this;
    }

    rotateY(angle) {
        quat.rotateY(this, angle, this);
        this.onChange();
        return this;
    }

    rotateZ(angle) {
        quat.rotateZ(this, angle, this);
        this.onChange();
        return this;
    }

    slerp(q, t) {
        quat.slerp(this, q, t, this);
        this.onChange();
        return this;
    }

    invert() {
        quat.inverse(this, this);
        this.onChange();
        return this;
    }

    conjugate() {
        quat.conjugate(this, this);
        this.onChange();
        return this;
    }

    normalize() {
        quat.normalize(this, this);
        this.onChange();
        return this;
    }

    dot(q) {
        return quat.dot(this, q);
    }

    len() {
        return quat.length(this);
    }

    equals(q) {
        return this[0] === q[0] && this[1] === q[1] && this[2] === q[2] && this[3] === q[3];
    }

    fromArray(a, o = 0) {
        this[0] = a[o];
        this[1] = a[o + 1];
        this[2] = a[o + 2];
        this[3] = a[o + 3];
        this.onChange();
        return this;
    }

    toArray(a = [], o = 0) {
        a[o] = this[0];
        a[o + 1] = this[1];
        a[o + 2] = this[2];
        a[o + 3] = this[3];
        return a;
    }

    // alternate-name aliases
    fromEuler(x, y, z, order = 'xyz') {
        return this.setFromEuler(x, y, z, order);
    }
    fromAxisAngle(axis, angle) {
        return this.setFromAxisAngle(axis, angle);
    }
    inverse() {
        return this.invert();
    }
}
