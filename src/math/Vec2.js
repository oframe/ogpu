import { vec2 } from 'wgpu-matrix';

/**
 * 2-component vector. Subclasses Float32Array for drop-in wgpu-matrix
 * interop plus a chainable three.js-style API.
 */
export class Vec2 extends Float32Array {
    constructor(x = 0, y = 0) {
        super(2);
        this[0] = x;
        this[1] = y;
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

    set(x, y) {
        if (typeof x === 'object' && x !== null) {
            super.set(x, y);
            return this;
        }
        this[0] = x;
        if (y !== undefined) this[1] = y;
        return this;
    }

    copy(v) {
        this[0] = v[0];
        this[1] = v[1];
        return this;
    }

    clone() {
        return new Vec2(this[0], this[1]);
    }

    add(v) {
        vec2.add(this, v, this);
        return this;
    }

    sub(v) {
        vec2.subtract(this, v, this);
        return this;
    }

    multiply(v) {
        vec2.multiply(this, v, this);
        return this;
    }

    scale(s) {
        vec2.scale(this, s, this);
        return this;
    }

    // three.js alias for scale.
    multiplyScalar(s) {
        vec2.scale(this, s, this);
        return this;
    }

    negate() {
        vec2.negate(this, this);
        return this;
    }

    normalize() {
        vec2.normalize(this, this);
        return this;
    }

    lerp(v, t) {
        vec2.lerp(this, v, t, this);
        return this;
    }

    dot(v) {
        return vec2.dot(this, v);
    }

    len() {
        return vec2.length(this);
    }

    lenSq() {
        return vec2.lengthSq(this);
    }

    distance(v) {
        return vec2.distance(this, v);
    }

    equals(v) {
        return this[0] === v[0] && this[1] === v[1];
    }

    fromArray(a, o = 0) {
        this[0] = a[o];
        this[1] = a[o + 1];
        return this;
    }

    toArray(a = [], o = 0) {
        a[o] = this[0];
        a[o + 1] = this[1];
        return a;
    }

    // alternate-name aliases
    squaredLen() {
        return this.lenSq();
    }
}
