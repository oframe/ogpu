// vec2: 2 floats. Out param last and optional (allocated when omitted), returned.
// Componentwise ops are written out per size (vec3/vec4 too; see
// src/math/CLAUDE.md). Elementwise, so out may alias any input.

export function add(a, b, out) {
    out ??= new Float32Array(2);
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
}

export function subtract(a, b, out) {
    out ??= new Float32Array(2);
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
}

export function multiply(a, b, out) {
    out ??= new Float32Array(2);
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    return out;
}

export function scale(v, k, out) {
    out ??= new Float32Array(2);
    out[0] = v[0] * k;
    out[1] = v[1] * k;
    return out;
}

export function negate(v, out) {
    out ??= new Float32Array(2);
    out[0] = -v[0];
    out[1] = -v[1];
    return out;
}

export function lerp(a, b, t, out) {
    out ??= new Float32Array(2);
    out[0] = a[0] + t * (b[0] - a[0]);
    out[1] = a[1] + t * (b[1] - a[1]);
    return out;
}

// zero-length input stays zero (scale 1), never NaN
export function normalize(v, out) {
    out ??= new Float32Array(2);
    const x = v[0];
    const y = v[1];
    const lenSq = x * x + y * y;
    const k = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 1;
    out[0] = x * k;
    out[1] = y * k;
    return out;
}

export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
}

export function lengthSq(v) {
    return v[0] * v[0] + v[1] * v[1];
}

export function length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

export function distance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}
