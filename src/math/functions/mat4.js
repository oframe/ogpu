// mat4: wgpu-matrix 3.4.2's mat4 (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported. inverse, lookAt and aim are local: measured
// faster than wgpu-matrix's (inverse ~18%, aim ~25%, lookAt ~5%; V8
// microbench), same Float32Array results.
// Column-major, 16 floats; element (row r, col c) lives at [c * 4 + r].
import { mat4, vec3 } from 'wgpu-matrix';

export const { copy, determinant, fromQuat, getAxis, getScaling, getTranslation, identity, multiply, ortho, perspective, rotateX, rotateY, rotateZ, scale, translate, transpose } = mat4;
const { cross, normalize, subtract } = vec3;

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
