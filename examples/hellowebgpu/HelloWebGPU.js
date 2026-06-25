import { Camera, Renderer, Orbit, GUI, RenderPipeline, Mesh, Transform, Box } from 'ogpu';

import cubeShader from './cube.wgsl?raw';

import { BoxMesh } from './BoxMesh.js';
import { makeUniformStruct } from './uniformStruct.js';

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

        const boxRenderPipeline = new RenderPipeline(this.gpu, {
            label: 'third-box-pipeline',
            code: cubeShader,
            vertexBuffers: geometry.bufferLayouts,
            depthTest: true,
            depthWrite: false,
            transparent: true,
        });

        const scaleDef = boxRenderPipeline.defs.uniforms.scaleUniform;
        const alphaDef = boxRenderPipeline.defs.uniforms.alphaUniform;

        // each mesh owns its own scale + alpha uniform structs, bound at
        // binding 1 / 2 alongside the mesh's standard uniforms at binding 0.
        const scaleAlphaEntries = (uniformBuffer, scale, alpha) => [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: scale.uniformBuffer } },
            { binding: 2, resource: { buffer: alpha.uniformBuffer } },
        ];

        this.secondScale = makeUniformStruct(this.gpu, scaleDef, { scale: 1 }, 'second-scale');
        this.secondAlpha = makeUniformStruct(this.gpu, alphaDef, { alpha: 1 }, 'second-alpha');

        this.secondBox = new Mesh(this.gpu, {
            label: 'second-webgpu-box',
            pipeline: boxRenderPipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: boxRenderPipeline.bindGroupLayout(0),
                    entries: scaleAlphaEntries(uniformBuffer, this.secondScale, this.secondAlpha),
                }),
            ],
        });

        this.secondBox.setParent(this.scene);
        this.secondBox.position.x = -1.0;
        this.secondBox.position.y = -1.0;
        this.secondBox.position.z = 0;

        this.thirdScale = makeUniformStruct(this.gpu, scaleDef, { scale: 0.5 }, 'third-scale');
        this.thirdAlpha = makeUniformStruct(this.gpu, alphaDef, { alpha: 0.5 }, 'third-alpha');

        this.thirdBox = new Mesh(this.gpu, {
            label: 'third-webgpu-box',
            pipeline: boxRenderPipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: boxRenderPipeline.bindGroupLayout(0),
                    entries: scaleAlphaEntries(uniformBuffer, this.thirdScale, this.thirdAlpha),
                }),
            ],
        });

        this.thirdBox.setParent(this.scene);
        this.thirdBox.position.x = 0.0;
        this.thirdBox.position.y = 1.0;

        this.params = { rotate: true, speed: 1.0 };

        this.gui = new GUI({ title: 'hello webgpu' });
        this.gui.add(this.params, 'rotate');
        this.gui.add(this.params, 'speed', { min: 0, max: 5, step: 0.01 });
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
