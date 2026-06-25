import { vec4 } from 'wgpu-matrix';

/**
 * 4-component vector. Subclasses Float32Array so it stays a drop-in
 * argument for any wgpu-matrix call, while adding a three.js-style
 * chainable API: `v.set(1, 2, 3, 4).add(other).normalize()`.
 */
export class Vec4 extends Float32Array {
    constructor(x = 0, y = 0, z = 0, w = 0) {
        super(4);
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this[3] = w;
    }

    get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
    }
    get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
    }
    get z() {
        return this[2];
    }
    set z(v) {
        this[2] = v;
    }
    get w() {
        return this[3];
    }
    set w(v) {
        this[3] = v;
    }

    /**
     * `set(x, y, z, w)` sets components. Falls back to the native
     * `Float32Array.set(arrayLike, offset)` when handed an array.
     */
    set(x, y, z, w) {
        if (typeof x === 'object' && x !== null) {
            super.set(x, y);
            return this;
        }
        this[0] = x;
        if (y !== undefined) this[1] = y;
        if (z !== undefined) this[2] = z;
        if (w !== undefined) this[3] = w;
        return this;
    }

    copy(v) {
        this[0] = v[0];
        this[1] = v[1];
        this[2] = v[2];
        this[3] = v[3];
        return this;
    }

    clone() {
        return new Vec4(this[0], this[1], this[2], this[3]);
    }

    add(v) {
        vec4.add(this, v, this);
        return this;
    }

    sub(v) {
        vec4.subtract(this, v, this);
        return this;
    }

    multiply(v) {
        vec4.multiply(this, v, this);
        return this;
    }

    scale(s) {
        vec4.scale(this, s, this);
        return this;
    }

    // three.js alias for scale.
    multiplyScalar(s) {
        vec4.scale(this, s, this);
        return this;
    }

    addScaled(v, s) {
        vec4.addScaled(this, v, s, this);
        return this;
    }

    negate() {
        vec4.negate(this, this);
        return this;
    }

    normalize() {
        vec4.normalize(this, this);
        return this;
    }

    lerp(v, t) {
        vec4.lerp(this, v, t, this);
        return this;
    }

    min(v) {
        vec4.min(this, v, this);
        return this;
    }

    max(v) {
        vec4.max(this, v, this);
        return this;
    }

    applyMat4(m) {
        vec4.transformMat4(this, m, this);
        return this;
    }

    dot(v) {
        return vec4.dot(this, v);
    }

    len() {
        return vec4.length(this);
    }

    lenSq() {
        return vec4.lengthSq(this);
    }

    distance(v) {
        return vec4.distance(this, v);
    }

    distanceSq(v) {
        return vec4.distanceSq(this, v);
    }

    equals(v) {
        return this[0] === v[0] && this[1] === v[1] && this[2] === v[2] && this[3] === v[3];
    }

    fromArray(a, o = 0) {
        this[0] = a[o];
        this[1] = a[o + 1];
        this[2] = a[o + 2];
        this[3] = a[o + 3];
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
    applyMatrix4(m) {
        return this.applyMat4(m);
    }
    squaredLen() {
        return this.lenSq();
    }
    squaredDistance(v) {
        return this.distanceSq(v);
    }
}
