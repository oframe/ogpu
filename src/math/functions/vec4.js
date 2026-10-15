// vec4: 4 floats. Out param last and optional (allocated when omitted), returned.
// Componentwise ops written out per size (see vec2.js); out may alias any input.

export function add(a, b, out) {
    out ??= new Float32Array(4);
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    out[3] = a[3] + b[3];
    return out;
}

export function subtract(a, b, out) {
    out ??= new Float32Array(4);
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    out[3] = a[3] - b[3];
    return out;
}

export function multiply(a, b, out) {
    out ??= new Float32Array(4);
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    out[3] = a[3] * b[3];
    return out;
}

export function scale(v, k, out) {
    out ??= new Float32Array(4);
    out[0] = v[0] * k;
    out[1] = v[1] * k;
    out[2] = v[2] * k;
    out[3] = v[3] * k;
    return out;
}

export function addScaled(a, b, k, out) {
    out ??= new Float32Array(4);
    out[0] = a[0] + b[0] * k;
    out[1] = a[1] + b[1] * k;
    out[2] = a[2] + b[2] * k;
    out[3] = a[3] + b[3] * k;
    return out;
}

export function negate(v, out) {
    out ??= new Float32Array(4);
    out[0] = -v[0];
    out[1] = -v[1];
    out[2] = -v[2];
    out[3] = -v[3];
    return out;
}

export function lerp(a, b, t, out) {
    out ??= new Float32Array(4);
    out[0] = a[0] + t * (b[0] - a[0]);
    out[1] = a[1] + t * (b[1] - a[1]);
    out[2] = a[2] + t * (b[2] - a[2]);
    out[3] = a[3] + t * (b[3] - a[3]);
    return out;
}

export function min(a, b, out) {
    out ??= new Float32Array(4);
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    out[2] = Math.min(a[2], b[2]);
    out[3] = Math.min(a[3], b[3]);
    return out;
}

export function max(a, b, out) {
    out ??= new Float32Array(4);
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    out[2] = Math.max(a[2], b[2]);
    out[3] = Math.max(a[3], b[3]);
    return out;
}

// zero-length input stays zero (scale 1), never NaN
export function normalize(v, out) {
    out ??= new Float32Array(4);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const w = v[3];
    const lenSq = x * x + y * y + z * z + w * w;
    const k = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 1;
    out[0] = x * k;
    out[1] = y * k;
    out[2] = z * k;
    out[3] = w * k;
    return out;
}

export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function lengthSq(v) {
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3];
}

export function length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]);
}

export function distanceSq(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    const dw = a[3] - b[3];
    return dx * dx + dy * dy + dz * dz + dw * dw;
}

export function distance(a, b) {
    return Math.sqrt(distanceSq(a, b));
}

// m * v, column-major, no divide
export function transformMat4(v, m, out) {
    out ??= new Float32Array(4);
    const x = v[0];
    const y = v[1];
    const z = v[2];
    const w = v[3];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return out;
}
