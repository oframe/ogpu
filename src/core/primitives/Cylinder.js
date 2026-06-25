import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Cylinder geometry. Wraps webgpu-utils createCylinderVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.radius=1] radius of the cylinder
 * @param {number} [opts.height=1] height of the cylinder
 * @param {number} [opts.radialSubdivisions=24] number of subdivisions around the circumference
 * @param {number} [opts.verticalSubdivisions=1] number of subdivisions along the height
 * @param {boolean} [opts.topCap=true] whether to generate the top cap
 * @param {boolean} [opts.bottomCap=true] whether to generate the bottom cap
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] interleave instanced buffers (Geometry passthrough)
 */
export class Cylinder extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createCylinderVertices(opts), instancedData, interleave });
        this.parameters = opts;
    }
}
