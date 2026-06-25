import { vec3 } from 'wgpu-matrix';

/**
 * 3-component vector. Subclasses Float32Array so it stays a drop-in
 * argument for any wgpu-matrix call, while adding a three.js-style
 * chainable API: `v.set(1, 2, 3).add(other).normalize()`.
 */
export class Vec3 extends Float32Array {
    constructor(x = 0, y = 0, z = 0) {
        super(3);
        this[0] = x;
        this[1] = y;
        this[2] = z;
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

    /**
     * `set(x, y, z)` sets components. Falls back to the native
     * `Float32Array.set(arrayLike, offset)` when handed an array.
     */
    set(x, y, z) {
        if (typeof x === 'object' && x !== null) {
            super.set(x, y);
            return this;
        }
        this[0] = x;
        if (y !== undefined) this[1] = y;
        if (z !== undefined) this[2] = z;
        return this;
    }

    copy(v) {
        this[0] = v[0];
        this[1] = v[1];
        this[2] = v[2];
        return this;
    }

    clone() {
        return new Vec3(this[0], this[1], this[2]);
    }

    add(v) {
        vec3.add(this, v, this);
        return this;
    }

    sub(v) {
        vec3.subtract(this, v, this);
        return this;
    }

    multiply(v) {
        vec3.multiply(this, v, this);
        return this;
    }

    scale(s) {
        vec3.scale(this, s, this);
        return this;
    }

    // three.js alias for scale.
    multiplyScalar(s) {
        vec3.scale(this, s, this);
        return this;
    }

    addScaled(v, s) {
        vec3.addScaled(this, v, s, this);
        return this;
    }

    negate() {
        vec3.negate(this, this);
        return this;
    }

    normalize() {
        vec3.normalize(this, this);
        return this;
    }

    lerp(v, t) {
        vec3.lerp(this, v, t, this);
        return this;
    }

    // fps-independent smoothing toward v. t = 1 - exp(-decay*dt).
    smoothLerp(v, decay, dt) {
        const t = 1 - Math.exp(-decay * dt);
        vec3.lerp(this, v, t, this);
        return this;
    }

    divide(v) {
        vec3.divide(this, v, this);
        return this;
    }

    // angle (radians) to v.
    angle(v) {
        return vec3.angle(this, v);
    }

    cross(v) {
        vec3.cross(this, v, this);
        return this;
    }

    min(v) {
        vec3.min(this, v, this);
        return this;
    }

    max(v) {
        vec3.max(this, v, this);
        return this;
    }

    applyMat4(m) {
        vec3.transformMat4(this, m, this);
        return this;
    }

    applyMat3(m) {
        vec3.transformMat3(this, m, this);
        return this;
    }

    applyQuat(q) {
        vec3.transformQuat(this, q, this);
        return this;
    }

    // Transform by the rotation/scale part of a Mat4 (no translation, no
    // perspective divide). Keeps length scaling — use for converting
    // distances between spaces.
    scaleRotateMat4(m) {
        vec3.transformMat4Upper3x3(this, m, this);
        return this;
    }

    // Transform as a direction: rotation/scale part of a Mat4, then normalize.
    transformDirection(m) {
        vec3.transformMat4Upper3x3(this, m, this);
        return this.normalize();
    }

    dot(v) {
        return vec3.dot(this, v);
    }

    len() {
        return vec3.length(this);
    }

    lenSq() {
        return vec3.lengthSq(this);
    }

    distance(v) {
        return vec3.distance(this, v);
    }

    distanceSq(v) {
        return vec3.distanceSq(this, v);
    }

    equals(v) {
        return this[0] === v[0] && this[1] === v[1] && this[2] === v[2];
    }

    fromArray(a, o = 0) {
        this[0] = a[o];
        this[1] = a[o + 1];
        this[2] = a[o + 2];
        return this;
    }

    toArray(a = [], o = 0) {
        a[o] = this[0];
        a[o + 1] = this[1];
        a[o + 2] = this[2];
        return a;
    }

    // alternate-name aliases
    applyMatrix4(m) {
        return this.applyMat4(m);
    }
    applyMatrix3(m) {
        return this.applyMat3(m);
    }
    applyQuaternion(q) {
        return this.applyQuat(q);
    }
    scaleRotateMatrix4(m) {
        return this.scaleRotateMat4(m);
    }
    squaredLen() {
        return this.lenSq();
    }
    squaredDistance(v) {
        return this.distanceSq(v);
    }
}
