// quat: (x, y, z, w), 4 floats. Out param last and optional (allocated when
// omitted), returned; out may alias any input.
import { cross, dot as dot3 } from './vec3.js';

export { dot, length } from './vec4.js';

export function identity(out) {
    out ??= new Float32Array(4);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
}

// a ⊗ b (Hamilton product): applies b, then a
export function mul(a, b, out) {
    out ??= new Float32Array(4);
    const ax = a[0];
    const ay = a[1];
    const az = a[2];
    const aw = a[3];
    const bx = b[0];
    const by = b[1];
    const bz = b[2];
    const bw = b[3];
    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
}

export function conjugate(q, out) {
    out ??= new Float32Array(4);
    out[0] = -q[0];
    out[1] = -q[1];
    out[2] = -q[2];
    out[3] = q[3];
    return out;
}

// conjugate / |q|²; a zero quaternion gives zeros
export function inverse(q, out) {
    out ??= new Float32Array(4);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    const lenSq = x * x + y * y + z * z + w * w;
    const k = lenSq ? 1 / lenSq : 0;
    out[0] = -x * k;
    out[1] = -y * k;
    out[2] = -z * k;
    out[3] = w * k;
    return out;
}

// near-zero length (≤ 1e-5) gives identity, unlike vecN.normalize
export function normalize(q, out) {
    out ??= new Float32Array(4);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    const len = Math.sqrt(x * x + y * y + z * z + w * w);
    if (len > 0.00001) {
        out[0] = x / len;
        out[1] = y / len;
        out[2] = z / len;
        out[3] = w / len;
    } else {
        identity(out);
    }
    return out;
}

export function fromAxisAngle(axis, angle, out) {
    out ??= new Float32Array(4);
    const s = Math.sin(angle * 0.5);
    out[0] = axis[0] * s;
    out[1] = axis[1] * s;
    out[2] = axis[2] * s;
    out[3] = Math.cos(angle * 0.5);
    return out;
}

// Order 'abc' = qa ⊗ qb ⊗ qc (the c-axis rotation applies first). Every order
// shares the same products; only the signs of the second terms differ.
const EULER_SIGNS = {
    xyz: [1, -1, 1, -1],
    xzy: [-1, -1, 1, 1],
    yxz: [1, -1, -1, 1],
    yzx: [1, 1, -1, -1],
    zxy: [-1, 1, 1, -1],
    zyx: [-1, 1, -1, 1],
};

// order is lowercase ('xyz', 'yxz', …); anything else throws
export function fromEuler(x, y, z, order, out) {
    out ??= new Float32Array(4);
    const signs = EULER_SIGNS[order];
    if (!signs) throw new Error(`Unknown rotation order: ${order}`);
    const sx = Math.sin(x * 0.5);
    const cx = Math.cos(x * 0.5);
    const sy = Math.sin(y * 0.5);
    const cy = Math.cos(y * 0.5);
    const sz = Math.sin(z * 0.5);
    const cz = Math.cos(z * 0.5);
    out[0] = sx * cy * cz + signs[0] * (cx * sy * sz);
    out[1] = cx * sy * cz + signs[1] * (sx * cy * sz);
    out[2] = cx * cy * sz + signs[2] * (sx * sy * cz);
    out[3] = cx * cy * cz + signs[3] * (sx * sy * sz);
    return out;
}

// Rotation part of a column-major mat4 or padded 12-float mat3 (same offsets),
// assumed orthonormal. Shoemake: solve for the largest of w, x, y, z first.
export function fromMat(m, out) {
    out ??= new Float32Array(4);
    const trace = m[0] + m[5] + m[10];
    if (trace > 0) {
        const r = Math.sqrt(trace + 1); // 2w
        const k = 0.5 / r; // 1 / 4w
        out[0] = (m[6] - m[9]) * k;
        out[1] = (m[8] - m[2]) * k;
        out[2] = (m[1] - m[4]) * k;
        out[3] = 0.5 * r;
        return out;
    }
    // largest diagonal i (ties keep the lower axis), then j, k cyclic
    let i = 0;
    if (m[5] > m[0]) i = 1;
    if (m[10] > m[i * 5]) i = 2;
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    const r = Math.sqrt(m[i * 5] - m[j * 5] - m[k * 5] + 1); // 2 * q_i
    const s = 0.5 / r;
    const w = (m[j * 4 + k] - m[k * 4 + j]) * s;
    const qj = (m[j * 4 + i] + m[i * 4 + j]) * s;
    const qk = (m[k * 4 + i] + m[i * 4 + k]) * s;
    out[i] = 0.5 * r;
    out[j] = qj;
    out[k] = qk;
    out[3] = w;
    return out;
}

const _axis = new Float32Array(3);

// Shortest arc taking unit vector a to unit vector b. Antiparallel input
// (dot < -0.999999) has no unique arc: it returns a 180° turn (axis, 0) about
// an axis perpendicular to a — x̂ × a, or ŷ × a when a is near the x axis.
export function rotationTo(a, b, out) {
    out ??= new Float32Array(4);
    const d = dot3(a, b);
    if (d < -0.999999) {
        // x̂ × a = (0, -az, ay); ŷ × a = (az, 0, -ax)
        let x = 0;
        let y = -a[2];
        let z = a[1];
        if (y * y + z * z < 0.000001) {
            x = a[2];
            y = 0;
            z = -a[0];
        }
        const k = 1 / Math.sqrt(x * x + y * y + z * z);
        out[0] = x * k;
        out[1] = y * k;
        out[2] = z * k;
        out[3] = 0;
        return out;
    }
    if (d > 0.999999) return identity(out);
    cross(a, b, _axis);
    out[0] = _axis[0];
    out[1] = _axis[1];
    out[2] = _axis[2];
    out[3] = 1 + d;
    return normalize(out, out);
}

// Spherical interpolation along the shorter arc; falls back to lerp (not
// renormalized) when the quaternions are within 1e-6 of each other.
export function slerp(a, b, t, out) {
    out ??= new Float32Array(4);
    const ax = a[0];
    const ay = a[1];
    const az = a[2];
    const aw = a[3];
    let bx = b[0];
    let by = b[1];
    let bz = b[2];
    let bw = b[3];
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) {
        cos = -cos;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    let ka = 1 - t;
    let kb = t;
    if (1 - cos > 0.000001) {
        const omega = Math.acos(cos);
        const sin = Math.sin(omega);
        ka = Math.sin(ka * omega) / sin;
        kb = Math.sin(t * omega) / sin;
    }
    out[0] = ka * ax + kb * bx;
    out[1] = ka * ay + kb * by;
    out[2] = ka * az + kb * bz;
    out[3] = ka * aw + kb * bw;
    return out;
}

// q ⊗ (rotation about one local axis)
export function rotateX(q, angle, out) {
    out ??= new Float32Array(4);
    const s = Math.sin(angle * 0.5);
    const c = Math.cos(angle * 0.5);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    out[0] = x * c + w * s;
    out[1] = y * c + z * s;
    out[2] = z * c - y * s;
    out[3] = w * c - x * s;
    return out;
}

export function rotateY(q, angle, out) {
    out ??= new Float32Array(4);
    const s = Math.sin(angle * 0.5);
    const c = Math.cos(angle * 0.5);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    out[0] = x * c - z * s;
    out[1] = y * c + w * s;
    out[2] = z * c + x * s;
    out[3] = w * c - y * s;
    return out;
}

export function rotateZ(q, angle, out) {
    out ??= new Float32Array(4);
    const s = Math.sin(angle * 0.5);
    const c = Math.cos(angle * 0.5);
    const x = q[0];
    const y = q[1];
    const z = q[2];
    const w = q[3];
    out[0] = x * c + y * s;
    out[1] = y * c - x * s;
    out[2] = z * c + w * s;
    out[3] = w * c - z * s;
    return out;
}
