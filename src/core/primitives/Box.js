import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Box geometry. Wraps webgpu-utils createCubeVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.size=1] edge length
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] interleave instanced buffers (Geometry passthrough)
 */
export class Box extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createCubeVertices(opts), instancedData, interleave });
        this.parameters = opts; // resolved shape options, for introspection
    }
}
