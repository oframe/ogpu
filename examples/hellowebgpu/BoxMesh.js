import { Transform, Shader, UniformBuffer, Mesh, Box } from 'ogpu';

import cubeShader from './cube.wgsl?raw';

export class BoxMesh extends Transform {
    constructor(gpu) {
        super();

        this.gpu = gpu;

        const geometry = new Box(this.gpu);

        const shader = new Shader(this.gpu, { label: 'simple-rendering', code: cubeShader });

        // scale + alpha share one uniform struct and buffer
        this.uniforms = new UniformBuffer(this.gpu, shader.uniforms, { uScale: 1, uAlpha: 1 }, { label: 'box-uniforms' });

        this.mesh = new Mesh({
            label: 'box-mesh',
            geometry,
            shader,
            state: { cullMode: 'back' },
            bindGroups: [shader.bindGroupLayout(0).createBindGroup({ uniforms: this.uniforms })],
        });

        this.mesh.setParent(this);
    }
}
