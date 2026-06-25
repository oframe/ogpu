import { primitives } from 'webgpu-utils';
import { Geometry } from '../Geometry.js';

/**
 * 3D "F" test geometry. Wraps webgpu-utils create3DFVertices (no shape options).
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {object} [opts]
 * @param {object} [opts.instancedData] (Geometry passthrough)
 * @param {boolean} [opts.interleave=false] (Geometry passthrough)
 */
export class ThreeDF extends Geometry {
    constructor(gpu, { instancedData, interleave } = {}) {
        super(gpu, { data: primitives.create3DFVertices(), instancedData, interleave });
    }
}
