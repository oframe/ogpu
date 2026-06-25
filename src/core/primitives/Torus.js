import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Torus geometry. Wraps webgpu-utils createTorusVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.radius=1] distance from the center of the tube to the center of the torus
 * @param {number} [opts.thickness=0.24] radius of the tube
 * @param {number} [opts.radialSubdivisions=24] number of subdivisions around the torus ring
 * @param {number} [opts.bodySubdivisions=12] number of subdivisions around the tube cross-section
 * @param {number} [opts.startAngle=0] start angle of the torus arc in radians
 * @param {number} [opts.endAngle=Math.PI*2] end angle of the torus arc in radians
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] interleave instanced buffers (Geometry passthrough)
 */
export class Torus extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createTorusVertices(opts), instancedData, interleave });
        this.parameters = opts; // resolved shape options, for introspection
    }
}
