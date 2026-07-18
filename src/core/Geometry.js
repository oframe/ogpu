import { createBuffersAndAttributesFromArrays } from 'webgpu-utils';
import { Vec3 } from '@math';

// Vertex data + GPU buffers (wraps webgpu-utils); non-instanced `data` + optional `instancedData`.
export class Geometry {
    // usage: extra GPUBufferUsage flags OR'd into every vertex/instance buffer.
    // webgpu-utils creates them VERTEX-only, so runtime updates via
    // queue.writeBuffer need `usage: GPUBufferUsage.COPY_DST` here.
    constructor(gpu, { data, instancedData, interleave = false, drawBuffer = null, usage = 0 } = {}) {
        if (!data) {
            throw new Error(
                'Geometry: `data` attribute arrays are required — drawBuffer-only geometry without vertex data is not supported'
            );
        }

        this.attributes = data;
        this.drawBuffer = drawBuffer;

        this.nonInstancedVerts = createBuffersAndAttributesFromArrays(gpu.device, data, { usage });

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

        this.instancedVerts = instancedData ? createBuffersAndAttributesFromArrays(gpu.device, instancedData, instanceOptions) : {};
        this.hasInstancedAttributes = this.instancedVerts?.buffers?.length > 0;

        this.bufferLayouts = [...this.nonInstancedVerts.bufferLayouts, ...(this.instancedVerts?.bufferLayouts || [])];

        this.numBuffers = this.nonInstancedVerts.buffers.length;
        if (this.hasInstancedAttributes) this.numBuffers += this.instancedVerts.buffers.length;
    }

    get instanced() {
        return this.hasInstancedAttributes || !!this.drawBuffer;
    }

    // Normalize this.attributes.position to {data, stride}. webgpu-utils
    // accepts a bare (typed) array or a {data, numComponents} descriptor.
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
