import { Transform, RenderPipeline, Mesh, Box } from 'ogpu';

import cubeShader from './cube.wgsl?raw';
import { makeUniformStruct } from './uniformStruct.js';

export class BoxMesh extends Transform {
    constructor(gpu) {
        super();

        this.gpu = gpu;

        const geometry = new Box(this.gpu);

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'simple-rendering',
            code: cubeShader,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'back',
        });

        // scale + alpha live in their own uniform structs/buffers, bound at
        // binding 1 and 2 of this pipeline's group(0).
        this.scaleStruct = makeUniformStruct(this.gpu, pipeline.defs.uniforms.scaleUniform, { scale: 1 }, 'box-scale');
        this.alphaStruct = makeUniformStruct(this.gpu, pipeline.defs.uniforms.alphaUniform, { alpha: 1 }, 'box-alpha');

        this.mesh = new Mesh(this.gpu, {
            label: 'box-mesh',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: { buffer: this.scaleStruct.uniformBuffer } },
                        { binding: 2, resource: { buffer: this.alphaStruct.uniformBuffer } },
                    ],
                }),
            ],
        });

        this.mesh.setParent(this);
    }
}
