import { mat4 } from 'wgpu-matrix';
import { fromRotationMatrix } from '@utils/EulerUtils';
import { Quat } from './Quat';

// Scratch for reorder().
const _q = new Quat();

/**
 * Euler angles (x, y, z radians) with a rotation order (default YXZ). Subclasses
 * Float32Array for a chainable three.js-style API. Pairs with Quat via
 * `setFromQuaternion` (Quat→Euler) and `Quat.setFromEuler` (Euler→Quat).
 *
 * onChange contract (mirror of Quat): mutators fire `onChange()` so Transform
 * re-derives the quaternion. Exception: `setFromQuaternion` detaches onChange
 * while it runs (Quat→Euler direction) to avoid looping.
 */
export class Euler extends Float32Array {
    constructor(x = 0, y = 0, z = 0, order = 'YXZ') {
        super(3);
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this.order = order;
        // Fired after any mutation. Transform wires this to keep `quaternion`
        // in sync. `setFromQuaternion` is the Quat→Euler direction and detaches
        // it to avoid looping. Default is a noop.
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

    set(x, y, z, order = this.order) {
        if (typeof x === 'object' && x !== null) {
            super.set(x, y);
            this.onChange();
            return this;
        }
        this[0] = x;
        if (y !== undefined) this[1] = y;
        if (z !== undefined) this[2] = z;
        this.order = order;
        this.onChange();
        return this;
    }

    copy(e) {
        this[0] = e[0];
        this[1] = e[1];
        this[2] = e[2];
        if (e.order) this.order = e.order;
        this.onChange();
        return this;
    }

    clone() {
        return new Euler(this[0], this[1], this[2], this.order);
    }

    setFromRotationMatrix(m, order = this.order) {
        fromRotationMatrix(m, order, this);
        this.order = order;
        this.onChange();
        return this;
    }

    // Quat→Euler direction: detach onChange so re-deriving angles from the
    // quaternion doesn't fire back into Transform's Euler→Quat sync.
    setFromQuaternion(q, order = this.order) {
        const cb = this.onChange;
        this.onChange = () => {};
        this.setFromRotationMatrix(mat4.fromQuat(q), order);
        this.onChange = cb;
        return this;
    }

    // Re-express same orientation in a new order. Round-trips via quat.
    reorder(order) {
        _q.setFromEuler(this[0], this[1], this[2], this.order.toLowerCase());
        this.setFromQuaternion(_q, order);
        this.onChange();
        return this;
    }

    fromArray(a, o = 0) {
        this[0] = a[o];
        this[1] = a[o + 1];
        this[2] = a[o + 2];
        this.onChange();
        return this;
    }

    toArray(a = [], o = 0) {
        a[o] = this[0];
        a[o + 1] = this[1];
        a[o + 2] = this[2];
        return a;
    }
}
