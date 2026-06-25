import { mat3, mat4 } from 'wgpu-matrix';
import { adjugate } from '@utils/Mat3Utils';

/**
 * 3x3 column-major matrix (wgpu-matrix pads to 12 floats). Subclasses
 * Float32Array for drop-in interop plus a chainable API. Defaults to
 * identity.
 */
export class Mat3 extends Float32Array {
    constructor() {
        super(12);
        mat3.identity(this);
    }

    set(...values) {
        if (values.length === 1 && typeof values[0] === 'object') {
            super.set(values[0], values[1] || 0);
            return this;
        }
        mat3.set(...values, this);
        return this;
    }

    copy(m) {
        mat3.copy(m, this);
        return this;
    }

    clone() {
        return new Mat3().copy(this);
    }

    identity() {
        mat3.identity(this);
        return this;
    }

    multiply(m) {
        mat3.multiply(this, m, this);
        return this;
    }

    invert() {
        mat3.inverse(this, this);
        return this;
    }

    transpose() {
        mat3.transpose(this, this);
        return this;
    }

    fromMat4(m) {
        mat3.fromMat4(m, this);
        return this;
    }

    /** Normal matrix = adjugate (inverse-transpose) of a mat4's upper 3x3. */
    fromNormalMatrix(m) {
        adjugate(m, this);
        return this;
    }

    fromQuat(q) {
        mat3.fromMat4(mat4.fromQuat(q), this);
        return this;
    }

    fromArray(a, o = 0) {
        for (let i = 0; i < 12; i++) this[i] = a[o + i];
        return this;
    }

    toArray(a = [], o = 0) {
        for (let i = 0; i < 12; i++) a[o + i] = this[i];
        return a;
    }
}
