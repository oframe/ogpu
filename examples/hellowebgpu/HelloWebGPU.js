import { Camera, Renderer, Orbit, GUI, Shader, UniformBuffer, Mesh, Transform, Box } from 'ogpu';

import cubeShader from './cube.wgsl?raw';

import { BoxMesh } from './BoxMesh.js';

export class HelloWebGPU {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.gpu = this.renderer.gpu;
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });

        this.camera.position.set(0, 0, 6);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        this.box = new BoxMesh(this.gpu);
        this.box.setParent(this.scene);
        this.box.scaleStruct.set({ scale: 0.1 });
        this.box.alphaStruct.set({ alpha: 1 });

        this.box.position.x = 1.0;
        this.box.position.y = -1.0;

        const geometry = new Box(this.gpu);
        const shader = new Shader(this.gpu, { label: 'third-box-shader', code: cubeShader });
        const glass = { transparent: true, depthWrite: false };

        const scaleDef = shader.defs.uniforms.scaleUniform;
        const alphaDef = shader.defs.uniforms.alphaUniform;

        // each mesh owns its own scale + alpha UniformBuffers, bound by WGSL name
        const scaleAlpha = (scale, alpha) => [shader.bindGroup(0, { scaleUniform: scale, alphaUniform: alpha })];

        this.secondScale = new UniformBuffer(this.gpu, scaleDef, { scale: 1 }, { label: 'second-scale' });
        this.secondAlpha = new UniformBuffer(this.gpu, alphaDef, { alpha: 1 }, { label: 'second-alpha' });

        this.secondBox = new Mesh({
            label: 'second-webgpu-box',
            geometry,
            shader,
            state: glass,
            bindGroups: scaleAlpha(this.secondScale, this.secondAlpha),
        });

        this.secondBox.setParent(this.scene);
        this.secondBox.position.x = -1.0;
        this.secondBox.position.y = -1.0;
        this.secondBox.position.z = 0;

        this.thirdScale = new UniformBuffer(this.gpu, scaleDef, { scale: 0.5 }, { label: 'third-scale' });
        this.thirdAlpha = new UniformBuffer(this.gpu, alphaDef, { alpha: 0.5 }, { label: 'third-alpha' });

        this.thirdBox = new Mesh({
            label: 'third-webgpu-box',
            geometry,
            shader,
            state: glass,
            bindGroups: scaleAlpha(this.thirdScale, this.thirdAlpha),
        });

        this.thirdBox.setParent(this.scene);
        this.thirdBox.position.x = 0.0;
        this.thirdBox.position.y = 1.0;

        this.params = { rotate: true, speed: 1.0, glass: true };

        this.gui = new GUI({ title: 'hello webgpu' });
        this.gui.add(this.params, 'rotate');
        this.gui.add(this.params, 'speed', { min: 0, max: 5, step: 0.01 });
        // a state swap selects another cached pipeline; the shader-owned bind group stays valid
        this.gui.add(this.params, 'glass').on('change', ({ value }) => {
            this.thirdBox.state = value ? glass : {};
        });
        this.gui.uniform(this.thirdScale, 'scale', { min: 0, max: 2, step: 0.01 });
        this.gui.uniform(this.thirdAlpha, 'alpha', { min: 0, max: 1, step: 0.01 });

        addEventListener('resize', this.handleResize);

        setTimeout((_) => {
            this.handleResize();
        }, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);

        if (this.params.rotate) {
            const s = this.params.speed;
            this.box.rotateX(this.renderer.deltaTime * s);
            this.box.rotateY(this.renderer.deltaTime * 0.5 * s);

            this.secondBox.rotateX(this.renderer.deltaTime * 1.34235 * s);
            this.secondBox.rotateY(this.renderer.deltaTime * 0.8 * s);

            this.thirdBox.rotateX(this.renderer.deltaTime * s);
            this.thirdBox.rotateY(this.renderer.deltaTime * 3.12 * s);
        }

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
