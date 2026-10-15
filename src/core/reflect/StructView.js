import { makeTypedArrayViews } from '@utils/webgpu-utils.js';
import { float16Shimmed } from '@utils/float16-shim.js';

// Named typed-array views over one ArrayBuffer (webgpu-utils' makeTypedArrayViews),
// laid out by a reflected WGSL type (from `reflect()`: defs.uniforms.<name>,
// defs.storages.<name> or defs.structs.<Name>). Shape: `.views` (nested per
// struct field / array element), `.arrayBuffer`, `.set(values)`, `.type`.
//
// Views: scalars and vectors are typed arrays (a scalar is length 1); an array
// of intrinsics is ONE flat typed array (array<vec3f, N> → Float32Array(4N),
// padding included); an array of structs is a JS array of view objects. f16:
// a scalar is a Uint16Array (raw bits), vectors and matrices are Float16Array —
// without a native one (Chrome/Edge < 135) the shim's raw-bits stub, warned once.
export class StructView {
    // def: a reflected variable ({ typeDefinition, group, … }) or a type/struct definition.
    // Pass `arrayBuffer` for runtime-sized arrays (the def's size is the fixed part only).
    constructor(def, arrayBuffer, byteOffset = 0) {
        if (!def) throw new Error('StructView: no struct definition (shader has no such var?)');
        const type = def.group === undefined ? def : def.typeDefinition;
        const { views, arrayBuffer: buffer } = makeTypedArrayViews(type, arrayBuffer, byteOffset);
        this.type = type;
        this.arrayBuffer = buffer;
        this.views = views;
        if (float16Shimmed && !warnedF16 && hasF16Vector(type)) {
            warnedF16 = true;
            console.warn('[ogpu] no Float16Array in this browser: f16 vector/matrix fields hold raw bits, not values. Use f32 fields (or an f32 shader variant) here.');
        }
    }

    set(data) {
        setStructuredView(data, this.views);
        return this;
    }
}

let warnedF16 = false;
// f16 vectors/matrices are the views the stub backs (f16 scalars are Uint16Array either way)
const hasF16Vector = (t) => (t.elementType ? hasF16Vector(t.elementType) : t.fields ? Object.values(t.fields).some((f) => hasF16Vector(f.type)) : /^(vec|mat)\w*(h|<f16>)$/.test(t.type));

const isTypedArray = (a) => a && typeof a.length === 'number' && a.buffer instanceof ArrayBuffer && a.byteLength >= 0;

// Writes JS data into views: numbers, arrays, typed arrays, nested objects.
// Missing keys are left untouched; unknown keys are ignored. webgpu-utils'
// setStructuredView with the same semantics, kept local: the library's
// (Object.entries per object, ArrayBuffer.isView checks) measured 1.9x slower
// per UniformBuffer.set() of a small struct.
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

// webgpu-utils' call shape, returning a StructView.
export function makeStructuredView(def, arrayBuffer, byteOffset = 0) {
    return new StructView(def, arrayBuffer, byteOffset);
}
