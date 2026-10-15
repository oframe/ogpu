import { Vec3 } from '@math';

// Vertex data + GPU buffers; non-instanced `data` + optional `instancedData`.
export class Geometry {
    // usage: extra GPUBufferUsage flags OR'd into every vertex/instance buffer.
    // They're created VERTEX-only, so runtime updates via queue.writeBuffer
    // need `usage: GPUBufferUsage.COPY_DST` here.
    constructor(gpu, { data, instancedData, interleave = false, drawBuffer = null, drawBufferOffset = 0, usage = 0 } = {}) {
        if (!data) {
            throw new Error('Geometry: `data` attribute arrays are required — drawBuffer-only geometry without vertex data is not supported');
        }

        this.attributes = data;
        this.drawBuffer = drawBuffer;
        // Byte offset of this geometry's args inside `drawBuffer` — non-zero when
        // several geometries share one buffer of packed indirect args.
        this.drawBufferOffset = drawBufferOffset;

        this.nonInstancedVerts = createBuffers(gpu.device, data, { usage });

        // Max over ALL non-instanced buffer layouts, not just the first — a
        // multi-buffer (non-interleaved) geometry has attributes spread across
        // several layouts, any of which may hold the highest shaderLocation.
        const lastLoc = Math.max(-1, ...this.nonInstancedVerts.bufferLayouts.flatMap((l) => l.attributes.map((a) => a.shaderLocation)));
        const instancedShaderLocation = lastLoc + 1;

        const instanceOptions = {
            stepMode: 'instance',
            interleave,
            shaderLocation: instancedShaderLocation,
            usage,
        };

        this.instancedVerts = instancedData ? createBuffers(gpu.device, instancedData, instanceOptions) : {};
        this.hasInstancedAttributes = this.instancedVerts?.buffers?.length > 0;

        this.bufferLayouts = [...this.nonInstancedVerts.bufferLayouts, ...(this.instancedVerts?.bufferLayouts || [])];

        // pipeline-cache key part: geometries with equal layouts share pipelines
        this.layoutKey = JSON.stringify(this.bufferLayouts);

        this.numBuffers = this.nonInstancedVerts.buffers.length;
        if (this.hasInstancedAttributes) this.numBuffers += this.instancedVerts.buffers.length;
    }

    get instanced() {
        return this.hasInstancedAttributes || !!this.drawBuffer;
    }

    // Normalize this.attributes.position to {data, stride}. An attribute is a
    // bare (typed) array or a {data, numComponents} descriptor.
    _positionAttr() {
        const pos = this.attributes?.position;
        if (!pos) return null;
        const data = pos.data ?? pos;
        if (!data || typeof data.length !== 'number' || data.length === 0) return null;
        return { data, stride: pos.numComponents || 3 };
    }

    computeBoundingBox(attr = this._positionAttr()) {
        if (!attr) return null;

        if (!this.bounds) {
            this.bounds = {
                min: new Vec3(),
                max: new Vec3(),
                center: new Vec3(),
                scale: new Vec3(),
                radius: Infinity,
            };
        }

        const { data, stride } = attr;
        const { min, max, center, scale } = this.bounds;

        min.set(Infinity, Infinity, Infinity);
        max.set(-Infinity, -Infinity, -Infinity);

        // position may be 2-component (screen-space quads) — missing axes stay 0
        const z = stride > 2;
        for (let i = 0; i < data.length; i += stride) {
            const x = data[i];
            const y = data[i + 1];
            min.x = Math.min(x, min.x);
            min.y = Math.min(y, min.y);
            max.x = Math.max(x, max.x);
            max.y = Math.max(y, max.y);
            if (z) {
                min.z = Math.min(data[i + 2], min.z);
                max.z = Math.max(data[i + 2], max.z);
            }
        }
        if (!z) min.z = max.z = 0;

        scale.copy(max).sub(min);
        center.copy(min).add(max).scale(0.5);

        return this.bounds;
    }

    computeBoundingSphere(attr = this._positionAttr()) {
        if (!attr) return null;
        if (!this.bounds) this.computeBoundingBox(attr);

        const { data, stride } = attr;
        const { center } = this.bounds;

        let maxRadiusSq = 0;
        for (let i = 0; i < data.length; i += stride) {
            const dx = data[i] - center.x;
            const dy = data[i + 1] - center.y;
            const dz = (stride > 2 ? data[i + 2] : 0) - center.z;
            maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz);
        }
        this.bounds.radius = Math.sqrt(maxRadiusSq);

        return this.bounds;
    }

    destroy() {
        for (const buf of this.nonInstancedVerts.buffers) {
            buf.destroy();
        }
        this.nonInstancedVerts.indexBuffer?.destroy();

        if (this.hasInstancedAttributes) {
            for (const buf of this.instancedVerts.buffers) {
                buf.destroy();
            }
        }
        this.instancedVerts.indexBuffer?.destroy();
    }
}

// --- attribute arrays → GPU buffers (ported from webgpu-utils'
// createBuffersAndAttributesFromArrays, (c) Gregg Tavares, MIT) ---
//
// `arrays` maps attribute names to a typed array, a plain array, or
// `{ data, numComponents?, type?, normalize? }`; `indices` is the index list.
// Attributes get consecutive shader locations starting at `shaderLocation` (0),
// in key order. interleave (default true) packs them into one buffer per call.

const ATTRIB_FORMATS = new Map([
    [Int8Array, { formats: ['sint8', 'snorm8'], defaultForType: 1 }],
    [Uint8Array, { formats: ['uint8', 'unorm8'], defaultForType: 1 }],
    [Int16Array, { formats: ['sint16', 'snorm16'], defaultForType: 1 }],
    [Uint16Array, { formats: ['uint16', 'unorm16'], defaultForType: 1 }],
    [Int32Array, { formats: ['sint32', 'snorm32'], defaultForType: 0 }],
    [Uint32Array, { formats: ['uint32', 'unorm32'], defaultForType: 0 }],
    [Float32Array, { formats: ['float32', 'float32'], defaultForType: 0 }],
]);

const isTypedArray = (a) => a && typeof a.length === 'number' && a.buffer instanceof ArrayBuffer && typeof a.byteLength === 'number';

function toTypedArray(array, name) {
    if (isTypedArray(array)) return array;
    if (isTypedArray(array.data)) return array.data;
    const spec = Array.isArray(array) || typeof array === 'number' ? { data: array } : array;
    const Type = spec.type ?? (name === 'indices' ? Uint32Array : Float32Array);
    return new Type(spec.data);
}

function guessNumComponents(name, length) {
    const n = /coord|texture|uv/i.test(name) ? 2 : /color|colour/i.test(name) ? 4 : 3;
    if (length % n > 0) {
        throw new Error(`Geometry: can't guess numComponents for attribute '${name}' (${length} values, not divisible by ${n}) — specify it`);
    }
    return n;
}

function numComponentsOf(format) {
    const m = /(\w+)(?:x(\d))$/.exec(format);
    return m ? parseInt(m[2]) : 1;
}

function bufferLayoutsFromArrays(arrays, { interleave = true, stepMode = 'vertex', shaderLocation } = {}) {
    let location = shaderLocation ?? 0;
    let offset = 0;
    const bufferLayouts = [];
    const attributes = [];
    const typedArrays = [];
    for (const name of Object.keys(arrays)) {
        if (name === 'indices') continue;
        const array = arrays[name];
        const data = toTypedArray(array, name);
        const total = array.numComponents || guessNumComponents(name, (array.length ? array : array.data).length);
        // > 4 components split into several attributes (e.g. a mat4 as 4 x vec4)
        const step = (total / 4) % 1 === 0 ? 4 : (total / 3) % 1 === 0 ? 3 : 4;
        const { formats, defaultForType } = ATTRIB_FORMATS.get(Object.getPrototypeOf(data).constructor);
        const formatIndex = array.normalize === undefined ? defaultForType : array.normalize ? 1 : 0;
        for (let component = 0; component < total; component += step) {
            const n = Math.min(step, total - component);
            attributes.push({
                offset,
                format: `${formats[formatIndex]}${n > 1 ? `x${n}` : ''}`,
                shaderLocation: location++,
            });
            offset += n * data.BYTES_PER_ELEMENT;
            typedArrays.push({ data, offset: component, stride: total });
        }
        if (!interleave) {
            bufferLayouts.push({ stepMode, arrayStride: offset, attributes: attributes.slice() });
            offset = 0;
            attributes.length = 0;
        }
    }
    if (attributes.length) bufferLayouts.push({ stepMode, arrayStride: offset, attributes });
    return { bufferLayouts, typedArrays };
}

function interleave(attributes, typedArrays, arrayStride, arrayBuffer) {
    const views = new Map();
    attributes.forEach(({ offset, format }, i) => {
        const n = numComponentsOf(format);
        const { data, offset: srcOffset, stride } = typedArrays[i];
        const Ctor = Object.getPrototypeOf(data).constructor;
        let view = views.get(Ctor);
        if (!view) views.set(Ctor, (view = new Ctor(arrayBuffer)));
        for (let j = 0; j < data.length; j += stride) {
            const dst = (offset + (j / stride) * arrayStride) / view.BYTES_PER_ELEMENT;
            view.set(data.subarray(j + srcOffset, j + srcOffset + n), dst);
        }
    });
}

function createBuffers(device, arrays, options = {}) {
    const usage = options.usage || 0;
    const { bufferLayouts, typedArrays } = bufferLayoutsFromArrays(arrays, options);
    const buffers = [];
    let numElements = -1;
    let index = 0;
    for (const { attributes, arrayStride } of bufferLayouts) {
        const n = numComponentsOf(attributes[0].format);
        const { data, stride } = typedArrays[index];
        if (numElements < 0) numElements = data.length / stride;
        const buffer = device.createBuffer({
            usage: usage | GPUBufferUsage.VERTEX,
            size: arrayStride * numElements,
            mappedAtCreation: true,
        });
        const arrayBuffer = buffer.getMappedRange();
        if (attributes.length === 1 && arrayStride === data.BYTES_PER_ELEMENT * n) {
            new (Object.getPrototypeOf(data).constructor)(arrayBuffer).set(data);
        } else {
            interleave(attributes, typedArrays.slice(index), arrayStride, arrayBuffer);
        }
        buffer.unmap();
        buffers.push(buffer);
        index += attributes.length;
    }

    const result = { numElements, bufferLayouts, buffers };
    if (arrays.indices) {
        const indices = toTypedArray(arrays.indices, 'indices');
        const indexBuffer = device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX | usage,
            mappedAtCreation: true,
        });
        new (Object.getPrototypeOf(indices).constructor)(indexBuffer.getMappedRange()).set(indices);
        indexBuffer.unmap();
        result.indexBuffer = indexBuffer;
        result.indexFormat = indices instanceof Uint16Array ? 'uint16' : 'uint32';
        result.numElements = indices.length;
    }
    return result;
}
