import { Transform, Shader, UniformBuffer, Mesh, Box } from 'ogpu';

import cubeShader from './cube.wgsl?raw';

export class BoxMesh extends Transform {
    constructor(gpu) {
        super();

        this.gpu = gpu;

        const geometry = new Box(this.gpu);

        const shader = new Shader(this.gpu, { label: 'simple-rendering', code: cubeShader });

        // scale + alpha live in their own uniform structs/buffers, bound by WGSL name
        this.scaleStruct = new UniformBuffer(this.gpu, shader.defs.uniforms.scaleUniform, { scale: 1 }, { label: 'box-scale' });
        this.alphaStruct = new UniformBuffer(this.gpu, shader.defs.uniforms.alphaUniform, { alpha: 1 }, { label: 'box-alpha' });

        this.mesh = new Mesh({
            label: 'box-mesh',
            geometry,
            shader,
            state: { cullMode: 'back' },
            bindGroups: [shader.bindGroup(0, { scaleUniform: this.scaleStruct, alphaUniform: this.alphaStruct })],
        });

        this.mesh.setParent(this);
    }
}
