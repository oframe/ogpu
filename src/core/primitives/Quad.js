import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * XY quad geometry (screen-space / billboard). Wraps webgpu-utils createXYQuadVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.size=2] quad size
 * @param {number} [opts.xOffset=0]
 * @param {number} [opts.yOffset=0]
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] (Geometry passthrough)
 */
export class Quad extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createXYQuadVertices(opts), instancedData, interleave });
        this.parameters = opts;
    }
}
