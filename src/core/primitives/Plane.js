import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Plane geometry (XZ plane). Wraps webgpu-utils createPlaneVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.width=1]
 * @param {number} [opts.depth=1]
 * @param {number} [opts.subdivisionsWidth=1]
 * @param {number} [opts.subdivisionsDepth=1]
 * @param {object} [opts.instancedData] (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] (Geometry passthrough)
 */
export class Plane extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createPlaneVertices(opts), instancedData, interleave });
        this.parameters = opts;
    }
}
