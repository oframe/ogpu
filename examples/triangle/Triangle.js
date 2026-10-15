import { Renderer, Shader, UniformBuffer, Mesh, Transform, FullscreenTriangle } from 'ogpu';

import triangleShader from './triangle.wgsl?raw';

// Port of OGL's triangle-screen-shader: a single fullscreen covering triangle
// (position -1..3, uv 0..2; excess clipped) with an animated cos() color ramp.
// No camera — the vertex stage writes clip-space positions directly.
export class Triangle {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.scene = new Transform();

        const geometry = new FullscreenTriangle(this.gpu);

        const shader = new Shader(this.gpu, { label: 'triangle-screen-shader', code: triangleShader });
        const ub = new UniformBuffer(this.gpu, shader.uniforms, { uColor: [0.3, 0.2, 0.5] }, { label: 'triangle-uniforms' });

        this.mesh = new Mesh({
            label: 'triangle-screen-mesh',
            geometry,
            shader,
            state: { cullMode: 'none' },
            bindGroups: [shader.createBindGroup(0, { uniforms: ub })],
        });
        this.mesh.setParent(this.scene);

        this.gpu.renderer.add(this.update);
    }

    update = () => {
        this.renderer.render({ scene: this.scene });
    };
}
