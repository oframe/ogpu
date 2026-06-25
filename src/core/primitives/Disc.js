import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * Disc geometry (flat ring/disc). Wraps webgpu-utils createDiscVertices.
 * @param {object} gpu - OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {number} [opts.radius=1] - Outer radius of the disc.
 * @param {number} [opts.divisions=24] - Number of radial subdivisions around the disc.
 * @param {number} [opts.stacks=1] - Number of concentric ring subdivisions between innerRadius and radius.
 * @param {number} [opts.innerRadius=0] - Inner radius of the disc; 0 produces a solid disc, > 0 a ring.
 * @param {number} [opts.stackPower=1] - Power applied to stack spacing; values > 1 push rings toward the outer edge, < 1 toward the center.
 * @param {object} [opts.instancedData] - Instanced attribute arrays passed through to Geometry.
 * @param {boolean} [opts.interleave=false] - Whether instanced buffers are interleaved; passed through to Geometry.
 */
export class Disc extends Geometry {
    constructor(gpu, { instancedData, interleave, ...opts } = {}) {
        super(gpu, { data: primitives.createDiscVertices(opts), instancedData, interleave });
        this.parameters = opts;
    }
}
