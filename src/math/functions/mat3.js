// mat3: column-major, padded to 12 floats (3 columns × vec4, = WGSL mat3x3f).
// Element (row r, col c) lives at [c * 4 + r]; slots 3, 7, 11 are padding.
// Out param last and optional (allocated when omitted), returned; out may
// alias any input.

// takes the 9 values column by column; zeroes the padding
export function set(v0, v1, v2, v3, v4, v5, v6, v7, v8, out) {
    out ??= new Float32Array(12);
    out[0] = v0;
    out[1] = v1;
    out[2] = v2;
    out[3] = 0;
    out[4] = v3;
    out[5] = v4;
    out[6] = v5;
    out[7] = 0;
    out[8] = v6;
    out[9] = v7;
    out[10] = v8;
    out[11] = 0;
    return out;
}

// padding copied too; a longer source (a mat4) gives its upper 3x3, which
// shares the padded offsets. Exactly 12 floats are read: a shorter source
// leaves NaN (undefined in a plain array) in the missing slots.
export function copy(m, out) {
    out ??= new Float32Array(12);
    out[0] = m[0];
    out[1] = m[1];
    out[2] = m[2];
    out[3] = m[3];
    out[4] = m[4];
    out[5] = m[5];
    out[6] = m[6];
    out[7] = m[7];
    out[8] = m[8];
    out[9] = m[9];
    out[10] = m[10];
    out[11] = m[11];
    return out;
}

export function identity(out) {
    out ??= new Float32Array(12);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    return out;
}

// upper-left 3x3 of a mat4; zeroes the padding
export function fromMat4(m, out) {
    return set(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], out ?? new Float32Array(12));
}

export function multiply(a, b, out) {
    out ??= new Float32Array(12);
    const a00 = a[0];
    const a01 = a[1];
    const a02 = a[2];
    const a10 = a[4];
    const a11 = a[5];
    const a12 = a[6];
    const a20 = a[8];
    const a21 = a[9];
    const a22 = a[10];
    const b00 = b[0];
    const b01 = b[1];
    const b02 = b[2];
    const b10 = b[4];
    const b11 = b[5];
    const b12 = b[6];
    const b20 = b[8];
    const b21 = b[9];
    const b22 = b[10];
    out[0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22;
    return out;
}

// adjugate / determinant; a singular input yields Inf/NaN (no guard)
export function inverse(m, out) {
    out ??= new Float32Array(12);
    // mCR = column C, row R
    const m00 = m[0];
    const m01 = m[1];
    const m02 = m[2];
    const m10 = m[4];
    const m11 = m[5];
    const m12 = m[6];
    const m20 = m[8];
    const m21 = m[9];
    const m22 = m[10];
    // cofactors of the first row (column-major: m00, m10, m20)
    const c0 = m11 * m22 - m21 * m12;
    const c1 = m21 * m02 - m01 * m22;
    const c2 = m01 * m12 - m11 * m02;
    const invDet = 1 / (m00 * c0 + m10 * c1 + m20 * c2);
    out[0] = c0 * invDet;
    out[1] = c1 * invDet;
    out[2] = c2 * invDet;
    out[4] = (m20 * m12 - m10 * m22) * invDet;
    out[5] = (m00 * m22 - m20 * m02) * invDet;
    out[6] = (m10 * m02 - m00 * m12) * invDet;
    out[8] = (m10 * m21 - m20 * m11) * invDet;
    out[9] = (m20 * m01 - m00 * m21) * invDet;
    out[10] = (m00 * m11 - m10 * m01) * invDet;
    return out;
}

export function transpose(m, out) {
    out ??= new Float32Array(12);
    const m01 = m[1];
    const m02 = m[2];
    const m10 = m[4];
    const m12 = m[6];
    const m20 = m[8];
    const m21 = m[9];
    out[0] = m[0];
    out[1] = m10;
    out[2] = m20;
    out[4] = m01;
    out[5] = m[5];
    out[6] = m21;
    out[8] = m02;
    out[9] = m12;
    out[10] = m[10];
    return out;
}
