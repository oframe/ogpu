import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Sphere geometry. Wraps webgpu-utils createSphereVertices.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.radius=1] radius of the sphere
 * @param {number} [opts.subdivisionsAxis=24] number of subdivisions around the equator
 * @param {number} [opts.subdivisionsHeight=12] number of subdivisions from pole to pole
 * @param {number} [opts.startLatitudeInRadians=0] latitude at which to start generating vertices (0 = south pole)
 * @param {number} [opts.endLatitudeInRadians=Math.PI] latitude at which to stop generating vertices (Math.PI = north pole)
 * @param {number} [opts.startLongitudeInRadians=0] longitude at which to start generating vertices
 * @param {number} [opts.endLongitudeInRadians=Math.PI*2] longitude at which to stop generating vertices
 * @param {object} [opts.instancedData] per-instance attribute arrays (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] interleave instanced buffers (Geometry passthrough)
 */
export class Sphere extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createSphereVertices(opts), instancedData, interleave });
        this.parameters = opts; // resolved shape options
    }
}
