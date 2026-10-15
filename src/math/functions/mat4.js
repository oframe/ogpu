// mat4: column-major, 16 floats; element (row r, col c) lives at [c * 4 + r].
// Out param last and optional (allocated when omitted), returned; out may
// alias any input — values are read into locals before out is written.
import { cross, normalize, subtract } from './vec3.js';

// Unrolled, not out.set(m): set() measured ~13% slower on the per-node
// world-matrix update (2000-mesh stress scene) — a builtin call per 16 floats.
export function copy(m, out) {
    out ??= new Float32Array(16);
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
    out[12] = m[12];
    out[13] = m[13];
    out[14] = m[14];
    out[15] = m[15];
    return out;
}

// Unrolled: fill() measured ~2.3x slower.
export function identity(out) {
    out ??= new Float32Array(16);
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
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
}

export function multiply(a, b, out) {
    out ??= new Float32Array(16);
    const a00 = a[0];
    const a01 = a[1];
    const a02 = a[2];
    const a03 = a[3];
    const a10 = a[4];
    const a11 = a[5];
    const a12 = a[6];
    const a13 = a[7];
    const a20 = a[8];
    const a21 = a[9];
    const a22 = a[10];
    const a23 = a[11];
    const a30 = a[12];
    const a31 = a[13];
    const a32 = a[14];
    const a33 = a[15];
    const b00 = b[0];
    const b01 = b[1];
    const b02 = b[2];
    const b03 = b[3];
    const b10 = b[4];
    const b11 = b[5];
    const b12 = b[6];
    const b13 = b[7];
    const b20 = b[8];
    const b21 = b[9];
    const b22 = b[10];
    const b23 = b[11];
    const b30 = b[12];
    const b31 = b[13];
    const b32 = b[14];
    const b33 = b[15];
    // column c of out = a * column c of b
    out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
    return out;
}

// 2x2 sub-determinants of the top/bottom row pairs (Laplace expansion). Reads
// the column-major array as row-major, i.e. inverts the transpose and writes
// it back the same way — the transposes cancel. Singular input yields Inf/NaN.
export function inverse(m, out) {
    out ??= new Float32Array(16);
    const b00 = m[0];
    const b01 = m[1];
    const b02 = m[2];
    const b03 = m[3];
    const b10 = m[4];
    const b11 = m[5];
    const b12 = m[6];
    const b13 = m[7];
    const b20 = m[8];
    const b21 = m[9];
    const b22 = m[10];
    const b23 = m[11];
    const b30 = m[12];
    const b31 = m[13];
    const b32 = m[14];
    const b33 = m[15];
    const s0 = b00 * b11 - b10 * b01;
    const s1 = b00 * b12 - b10 * b02;
    const s2 = b00 * b13 - b10 * b03;
    const s3 = b01 * b12 - b11 * b02;
    const s4 = b01 * b13 - b11 * b03;
    const s5 = b02 * b13 - b12 * b03;
    const c0 = b20 * b31 - b30 * b21;
    const c1 = b20 * b32 - b30 * b22;
    const c2 = b20 * b33 - b30 * b23;
    const c3 = b21 * b32 - b31 * b22;
    const c4 = b21 * b33 - b31 * b23;
    const c5 = b22 * b33 - b32 * b23;
    const d = 1 / (s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0);
    out[0] = (b11 * c5 - b12 * c4 + b13 * c3) * d;
    out[1] = (b02 * c4 - b01 * c5 - b03 * c3) * d;
    out[2] = (b31 * s5 - b32 * s4 + b33 * s3) * d;
    out[3] = (b22 * s4 - b21 * s5 - b23 * s3) * d;
    out[4] = (b12 * c2 - b10 * c5 - b13 * c1) * d;
    out[5] = (b00 * c5 - b02 * c2 + b03 * c1) * d;
    out[6] = (b32 * s2 - b30 * s5 - b33 * s1) * d;
    out[7] = (b20 * s5 - b22 * s2 + b23 * s1) * d;
    out[8] = (b10 * c4 - b11 * c2 + b13 * c0) * d;
    out[9] = (b01 * c2 - b00 * c4 - b03 * c0) * d;
    out[10] = (b30 * s4 - b31 * s2 + b33 * s0) * d;
    out[11] = (b21 * s2 - b20 * s4 - b23 * s0) * d;
    out[12] = (b11 * c1 - b10 * c3 - b12 * c0) * d;
    out[13] = (b00 * c3 - b01 * c1 + b02 * c0) * d;
    out[14] = (b31 * s1 - b30 * s3 - b32 * s0) * d;
    out[15] = (b20 * s3 - b21 * s1 + b22 * s0) * d;
    return out;
}

export function determinant(m) {
    const s0 = m[0] * m[5] - m[4] * m[1];
    const s1 = m[0] * m[6] - m[4] * m[2];
    const s2 = m[0] * m[7] - m[4] * m[3];
    const s3 = m[1] * m[6] - m[5] * m[2];
    const s4 = m[1] * m[7] - m[5] * m[3];
    const s5 = m[2] * m[7] - m[6] * m[3];
    const c0 = m[8] * m[13] - m[12] * m[9];
    const c1 = m[8] * m[14] - m[12] * m[10];
    const c2 = m[8] * m[15] - m[12] * m[11];
    const c3 = m[9] * m[14] - m[13] * m[10];
    const c4 = m[9] * m[15] - m[13] * m[11];
    const c5 = m[10] * m[15] - m[14] * m[11];
    return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
}

export function transpose(m, out) {
    out ??= new Float32Array(16);
    const m01 = m[1];
    const m02 = m[2];
    const m03 = m[3];
    const m10 = m[4];
    const m12 = m[6];
    const m13 = m[7];
    const m20 = m[8];
    const m21 = m[9];
    const m23 = m[11];
    const m30 = m[12];
    const m31 = m[13];
    const m32 = m[14];
    out[0] = m[0];
    out[1] = m10;
    out[2] = m20;
    out[3] = m30;
    out[4] = m01;
    out[5] = m[5];
    out[6] = m21;
    out[7] = m31;
    out[8] = m02;
    out[9] = m12;
    out[10] = m[10];
    out[11] = m32;
    out[12] = m03;
    out[13] = m13;
    out[14] = m23;
    out[15] = m[15];
    return out;
}

// rotation matrix of a unit quaternion (x, y, z, w)
export function fromQuat(q, out) {
    out ??= new Float32Array(16);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const yy = y * y2;
    const zz = z * z2;
    const xy = x * y2;
    const xz = x * z2;
    const yz = y * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    out[0] = 1 - yy - zz;
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - xx - zz;
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - xx - yy;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
}

// m * translation(v)
export function translate(m, v, out) {
    out ??= new Float32Array(16);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const t0 = m[0] * x + m[4] * y + m[8] * z + m[12];
    const t1 = m[1] * x + m[5] * y + m[9] * z + m[13];
    const t2 = m[2] * x + m[6] * y + m[10] * z + m[14];
    const t3 = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (out !== m) {
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
    }
    out[12] = t0;
    out[13] = t1;
    out[14] = t2;
    out[15] = t3;
    return out;
}

// m * scaling(v): columns 0–2 scaled, column 3 kept. Scales straight from m
// (not set-then-scale, which rounds a non-f32 m twice).
export function scale(m, v, out) {
    out ??= new Float32Array(16);
    for (let c = 0; c < 3; c++) {
        const k = v[c];
        const o = c * 4;
        out[o] = m[o] * k;
        out[o + 1] = m[o + 1] * k;
        out[o + 2] = m[o + 2] * k;
        out[o + 3] = m[o + 3] * k;
    }
    if (out !== m) {
        out[12] = m[12];
        out[13] = m[13];
        out[14] = m[14];
        out[15] = m[15];
    }
    return out;
}

// m * rotation about one axis: mixes columns i and j (i0..i3, j0..j3), copies
// the other two. (i, j) = (1, 2) for X, (2, 0) for Y, (0, 1) for Z.
export function rotateX(m, angle, out) {
    out ??= new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const i0 = m[4];
    const i1 = m[5];
    const i2 = m[6];
    const i3 = m[7];
    const j0 = m[8];
    const j1 = m[9];
    const j2 = m[10];
    const j3 = m[11];
    if (out !== m) {
        out[0] = m[0];
        out[1] = m[1];
        out[2] = m[2];
        out[3] = m[3];
        out[12] = m[12];
        out[13] = m[13];
        out[14] = m[14];
        out[15] = m[15];
    }
    out[4] = c * i0 + s * j0;
    out[5] = c * i1 + s * j1;
    out[6] = c * i2 + s * j2;
    out[7] = c * i3 + s * j3;
    out[8] = c * j0 - s * i0;
    out[9] = c * j1 - s * i1;
    out[10] = c * j2 - s * i2;
    out[11] = c * j3 - s * i3;
    return out;
}

export function rotateY(m, angle, out) {
    out ??= new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const i0 = m[8];
    const i1 = m[9];
    const i2 = m[10];
    const i3 = m[11];
    const j0 = m[0];
    const j1 = m[1];
    const j2 = m[2];
    const j3 = m[3];
    if (out !== m) {
        out[4] = m[4];
        out[5] = m[5];
        out[6] = m[6];
        out[7] = m[7];
        out[12] = m[12];
        out[13] = m[13];
        out[14] = m[14];
        out[15] = m[15];
    }
    out[8] = c * i0 + s * j0;
    out[9] = c * i1 + s * j1;
    out[10] = c * i2 + s * j2;
    out[11] = c * i3 + s * j3;
    out[0] = c * j0 - s * i0;
    out[1] = c * j1 - s * i1;
    out[2] = c * j2 - s * i2;
    out[3] = c * j3 - s * i3;
    return out;
}

export function rotateZ(m, angle, out) {
    out ??= new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const i0 = m[0];
    const i1 = m[1];
    const i2 = m[2];
    const i3 = m[3];
    const j0 = m[4];
    const j1 = m[5];
    const j2 = m[6];
    const j3 = m[7];
    if (out !== m) {
        out[8] = m[8];
        out[9] = m[9];
        out[10] = m[10];
        out[11] = m[11];
        out[12] = m[12];
        out[13] = m[13];
        out[14] = m[14];
        out[15] = m[15];
    }
    out[0] = c * i0 + s * j0;
    out[1] = c * i1 + s * j1;
    out[2] = c * i2 + s * j2;
    out[3] = c * i3 + s * j3;
    out[4] = c * j0 - s * i0;
    out[5] = c * j1 - s * i1;
    out[6] = c * j2 - s * i2;
    out[7] = c * j3 - s * i3;
    return out;
}

// column `axis` (0 = x, 1 = y, 2 = z, 3 = translation) as a vec3
export function getAxis(m, axis, out) {
    out ??= new Float32Array(3);
    const o = axis * 4;
    out[0] = m[o];
    out[1] = m[o + 1];
    out[2] = m[o + 2];
    return out;
}

export function getTranslation(m, out) {
    return getAxis(m, 3, out);
}

// lengths of the first three columns
export function getScaling(m, out) {
    out ??= new Float32Array(3);
    for (let c = 0; c < 3; c++) {
        const o = c * 4;
        out[c] = Math.sqrt(m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2]);
    }
    return out;
}

// WebGPU clip space: depth maps [near, far] -> [0, 1]. far = Infinity gives
// the infinite-far limit.
export function perspective(fovy, aspect, near, far, out) {
    out ??= new Float32Array(16);
    const f = Math.tan(Math.PI * 0.5 - fovy * 0.5); // cot(fovy / 2)
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    if (Number.isFinite(far)) {
        const rangeInv = 1 / (near - far);
        out[10] = far * rangeInv;
        out[14] = far * near * rangeInv;
    } else {
        out[10] = -1;
        out[14] = -near;
    }
    return out;
}

// WebGPU clip space: depth maps [near, far] -> [0, 1]
export function ortho(left, right, bottom, top, near, far, out) {
    out ??= new Float32Array(16);
    out[0] = 2 / (right - left);
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 2 / (top - bottom);
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1 / (near - far);
    out[11] = 0;
    out[12] = (right + left) / (left - right);
    out[13] = (top + bottom) / (bottom - top);
    out[14] = near / (near - far);
    out[15] = 1;
    return out;
}

const _x = new Float32Array(3);
const _y = new Float32Array(3);
const _z = new Float32Array(3);

// basis with z along `forward`; up parallel to forward degenerates to zero
// x/y axes (normalize keeps zero vectors), matching the reference behaviour
function basis(forward, up) {
    normalize(forward, _z);
    normalize(cross(up, _z, _x), _x);
    normalize(cross(_z, _x, _y), _y);
}

// View matrix: camera at eye looking at target, −Z forward (inverse of aim).
export function lookAt(eye, target, up, out) {
    out ??= new Float32Array(16);
    basis(subtract(eye, target, _z), up);
    out[0] = _x[0];
    out[1] = _y[0];
    out[2] = _z[0];
    out[3] = 0;
    out[4] = _x[1];
    out[5] = _y[1];
    out[6] = _z[1];
    out[7] = 0;
    out[8] = _x[2];
    out[9] = _y[2];
    out[10] = _z[2];
    out[11] = 0;
    out[12] = -(_x[0] * eye[0] + _x[1] * eye[1] + _x[2] * eye[2]);
    out[13] = -(_y[0] * eye[0] + _y[1] * eye[1] + _y[2] * eye[2]);
    out[14] = -(_z[0] * eye[0] + _z[1] * eye[1] + _z[2] * eye[2]);
    out[15] = 1;
    return out;
}

// Object matrix at position with +Z toward target (not a view matrix).
export function aim(position, target, up, out) {
    out ??= new Float32Array(16);
    basis(subtract(target, position, _z), up);
    out[0] = _x[0];
    out[1] = _x[1];
    out[2] = _x[2];
    out[3] = 0;
    out[4] = _y[0];
    out[5] = _y[1];
    out[6] = _y[2];
    out[7] = 0;
    out[8] = _z[0];
    out[9] = _z[1];
    out[10] = _z[2];
    out[11] = 0;
    out[12] = position[0];
    out[13] = position[1];
    out[14] = position[2];
    out[15] = 1;
    return out;
}
