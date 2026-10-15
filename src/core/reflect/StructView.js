// Ported from webgpu-utils (https://github.com/greggman/webgpu-utils),
// Copyright (c) Gregg Tavares, MIT License.
// Named typed-array views over one ArrayBuffer, laid out by a reflected WGSL
// type (from `reflect()`: defs.uniforms.<name>, defs.storages.<name> or
// defs.structs.<Name>). Shape: `.views` (nested per struct field / array element),
// `.arrayBuffer`, `.set(values)`.
//
// Views: scalars and vectors are typed arrays (a scalar is length 1); an array
// of intrinsics is ONE flat typed array (array<vec3f, N> → Float32Array(4N), padding
// included); an array of structs is a JS array of view objects.

const T = (align, size, View) => ({ align, size, View });
const F = Float32Array;
const I = Int32Array;
const U = Uint32Array;
const H = Uint16Array; // f16 has no typed array — raw bits

const BASE = {
    i32: T(4, 4, I),
    u32: T(4, 4, U),
    f32: T(4, 4, F),
    f16: T(2, 2, H),
    vec2f: T(8, 8, F),
    vec2i: T(8, 8, I),
    vec2u: T(8, 8, U),
    vec2h: T(4, 4, H),
    vec3f: T(16, 12, F),
    vec3i: T(16, 12, I),
    vec3u: T(16, 12, U),
    vec3h: T(8, 6, H),
    vec4f: T(16, 16, F),
    vec4i: T(16, 16, I),
    vec4u: T(16, 16, U),
    vec4h: T(8, 8, H),
    mat2x2f: T(8, 16, F),
    mat2x2h: T(4, 8, H),
    mat3x2f: T(8, 24, F),
    mat3x2h: T(4, 12, H),
    mat4x2f: T(8, 32, F),
    mat4x2h: T(4, 16, H),
    mat2x3f: T(16, 32, F),
    mat2x3h: T(8, 16, H),
    mat3x3f: T(16, 48, F),
    mat3x3h: T(8, 24, H),
    mat4x3f: T(16, 64, F),
    mat4x3h: T(8, 32, H),
    mat2x4f: T(16, 32, F),
    mat2x4h: T(8, 16, H),
    mat3x4f: T(16, 48, F),
    mat3x4h: T(8, 24, H),
    mat4x4f: T(16, 64, F),
    mat4x4h: T(8, 32, H),
    // not host-shareable, but may appear in a struct that only lives in-shader
    bool: T(1, 0, U),
};

const SUFFIX = { f32: 'f', i32: 'i', u32: 'u', f16: 'h' };

// 'vec3<f32>' / 'atomic<u32>' → their short-alias info
function typeInfo(type) {
    const info = BASE[type];
    if (info) return info;
    const m = /^(\w+)<(\w+)>$/.exec(type);
    if (m) {
        if (m[1] === 'atomic') return BASE[m[2]];
        const short = BASE[m[1] + SUFFIX[m[2]]];
        if (short) return short;
    }
    throw new Error(`StructView: unknown type ${type}`);
}

const roundUp = (v, m) => Math.ceil(v / m) * m;
const isTypedArray = (a) => a && typeof a.length === 'number' && a.buffer instanceof ArrayBuffer && a.byteLength >= 0;
const isIntrinsic = (t) => !t.fields && !t.elementType;

function alignOf(t) {
    if (t.elementType) return alignOf(t.elementType);
    if (t.fields) return Object.values(t.fields).reduce((a, f) => Math.max(a, alignOf(f.type)), 0);
    return typeInfo(t.type).align;
}

// stride of one array element
function strideOf(arrayDef) {
    return roundUp(arrayDef.elementType.size, alignOf(arrayDef.elementType));
}

function intrinsicView(t, buffer, byteOffset, numElements) {
    const { View, align, size } = typeInfo(t.type);
    const isArray = numElements !== undefined;
    const bytes = isArray ? roundUp(t.size, align) : size;
    const per = bytes / View.BYTES_PER_ELEMENT;
    const count = !isArray ? 1 : numElements === 0 ? (buffer.byteLength - byteOffset) / bytes : numElements;
    return new View(buffer, byteOffset, per * count);
}

function makeViews(t, buffer, byteOffset) {
    if (t.elementType) {
        if (isIntrinsic(t.elementType)) {
            return intrinsicView(t.elementType, buffer, byteOffset, t.numElements);
        }
        const stride = strideOf(t);
        const n = t.numElements === 0 ? (buffer.byteLength - byteOffset) / stride : t.numElements;
        return Array.from({ length: n }, (_, i) => makeViews(t.elementType, buffer, byteOffset + stride * i));
    }
    if (t.fields) {
        const views = {};
        for (const [name, { type, offset }] of Object.entries(t.fields)) {
            views[name] = makeViews(type, buffer, byteOffset + offset);
        }
        return views;
    }
    return intrinsicView(t, buffer, byteOffset);
}

// Writes JS data into views: numbers, arrays, typed arrays, nested objects.
// Missing keys are left untouched; unknown keys are ignored.
export function setStructuredView(data, views) {
    if (data === undefined) return;
    if (isTypedArray(views)) {
        if (views.length === 1 && typeof data === 'number') {
            views[0] = data;
        } else if (Array.isArray(data[0]) || isTypedArray(data[0])) {
            // array of vectors into a flat view: vec3 elements pad to 4
            const len = data[0].length;
            const stride = len === 3 ? 4 : len;
            for (let i = 0; i < data.length; i++) views.set(data[i], i * stride);
        } else {
            views.set(data);
        }
    } else if (Array.isArray(views)) {
        data.forEach((v, i) => setStructuredView(v, views[i]));
    } else {
        for (const key of Object.keys(data)) {
            const view = views[key];
            if (view) setStructuredView(data[key], view);
        }
    }
}

export class StructView {
    // def: a reflected variable ({ typeDefinition, group, … }) or a type/struct definition.
    // Pass `arrayBuffer` for runtime-sized arrays (the def's size is the fixed part only).
    constructor(def, arrayBuffer, byteOffset = 0) {
        if (!def) throw new Error('StructView: no struct definition (shader has no such var?)');
        const type = def.group === undefined ? def : def.typeDefinition;
        this.type = type;
        this.arrayBuffer = arrayBuffer ?? new ArrayBuffer(type.size);
        this.views = makeViews(type, this.arrayBuffer, byteOffset);
    }

    set(data) {
        setStructuredView(data, this.views);
        return this;
    }
}

// Same call shape as before (webgpu-utils), so call sites only swap the import.
export function makeStructuredView(def, arrayBuffer, byteOffset = 0) {
    return new StructView(def, arrayBuffer, byteOffset);
}
