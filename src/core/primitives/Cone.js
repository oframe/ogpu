import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * (Truncated) cone geometry. Wraps webgpu-utils createTruncatedConeVertices.
 * Default topRadius=0 gives a pointed cone; set it >0 for a truncated cone.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.bottomRadius=1] radius of the bottom circle
 * @param {number} [opts.topRadius=0] radius of the top circle; 0 gives a pointed cone
 * @param {number} [opts.height=1] height of the cone
 * @param {number} [opts.radialSubdivisions=24] number of subdivisions around the circumference
 * @param {number} [opts.verticalSubdivisions=1] number of subdivisions along the height
 * @param {boolean} [opts.topCap=true] whether to generate the top cap
 * @param {boolean} [opts.bottomCap=true] whether to generate the bottom cap
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] interleave instanced buffers (Geometry passthrough)
 */
export class Cone extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createTruncatedConeVertices(opts), instancedData, interleave });
        this.parameters = opts;
    }
}
