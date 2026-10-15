// vec3: 3 floats. Out param last and optional (allocated when omitted), returned.
// Componentwise ops written out per size (see vec2.js); out may alias any input.

export function add(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
}

export function subtract(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
}

export function multiply(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    return out;
}

export function divide(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    return out;
}

export function scale(v, k, out) {
    out ??= new Float32Array(3);
    out[0] = v[0] * k;
    out[1] = v[1] * k;
    out[2] = v[2] * k;
    return out;
}

export function addScaled(a, b, k, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] + b[0] * k;
    out[1] = a[1] + b[1] * k;
    out[2] = a[2] + b[2] * k;
    return out;
}

export function negate(v, out) {
    out ??= new Float32Array(3);
    out[0] = -v[0];
    out[1] = -v[1];
    out[2] = -v[2];
    return out;
}

export function lerp(a, b, t, out) {
    out ??= new Float32Array(3);
    out[0] = a[0] + t * (b[0] - a[0]);
    out[1] = a[1] + t * (b[1] - a[1]);
    out[2] = a[2] + t * (b[2] - a[2]);
    return out;
}

export function min(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    out[2] = Math.min(a[2], b[2]);
    return out;
}

export function max(a, b, out) {
    out ??= new Float32Array(3);
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    out[2] = Math.max(a[2], b[2]);
    return out;
}

// zero-length input stays zero (scale 1), never NaN
export function normalize(v, out) {
    out ??= new Float32Array(3);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const lenSq = x * x + y * y + z * z;
    const k = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 1;
    out[0] = x * k;
    out[1] = y * k;
    out[2] = z * k;
    return out;
}

export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lengthSq(v) {
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export function length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function distanceSq(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}

export function distance(a, b) {
    return Math.sqrt(distanceSq(a, b));
}

export function cross(a, b, out) {
    out ??= new Float32Array(3);
    const ax = a[0];
    const ay = a[1];
    const az = a[2];
    const bx = b[0];
    const by = b[1];
    const bz = b[2];
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
}

// radians; a zero-length input gives acos(0) = π/2 (no clamp)
export function angle(a, b) {
    const mag = length(a) * length(b);
    return Math.acos(mag && dot(a, b) / mag);
}

// point transform: m * (v, 1), divided by w (w of 0 or NaN is treated as 1)
export function transformMat4(v, m, out) {
    out ??= new Float32Array(3);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return out;
}

// upper 3x3 of a mat4 (no translation, no divide)
export function transformMat4Upper3x3(v, m, out) {
    out ??= new Float32Array(3);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    return out;
}

// m is a padded 12-float mat3 (same column offsets as a mat4)
export function transformMat3(v, m, out) {
    return transformMat4Upper3x3(v, m, out);
}

// v' = v + 2w(q×v) + 2q×(q×v)
export function transformQuat(v, q, out) {
    out ??= new Float32Array(3);
    const qx = q[0];
    const qy = q[1];
    const qz = q[2];
    const w2 = q[3] * 2;
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const tx = qy * z - qz * y;
    const ty = qz * x - qx * z;
    const tz = qx * y - qy * x;
    out[0] = x + tx * w2 + (qy * tz - qz * ty) * 2;
    out[1] = y + ty * w2 + (qz * tx - qx * tz) * 2;
    out[2] = z + tz * w2 + (qx * ty - qy * tx) * 2;
    return out;
}
