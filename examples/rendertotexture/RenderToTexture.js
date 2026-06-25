import { Box, FullscreenTriangle, Mesh, Renderer, RenderPipeline, Transform, RenderTarget, Camera, Orbit } from 'ogpu';

import display from './display.wgsl?raw';
import cubeShader from './cube.wgsl?raw';

export class RenderToTexture {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.initTestScene();
        this.initDisplay();

        addEventListener('resize', this.handleResize);
        setTimeout((_) => {
            this.handleResize();
        }, 150);

        this.gpu.renderer.add(this.update);
    }

    initDisplay() {
        this.scene = new Transform();

        const geometry = new FullscreenTriangle(this.gpu);

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'display-pipeline',
            code: display,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
        });

        this.displayPipeline = pipeline;
        this.displaySampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.display = new Mesh(this.gpu, {
            label: 'display-mesh',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: 'display-rendering',
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        {
                            binding: pipeline.defs.samplers.sampler2d.binding,
                            resource: this.displaySampler,
                        },
                        {
                            binding: pipeline.defs.textures.map.binding,
                            resource: this.sceneBuffer.createView(0),
                        },
                        {
                            binding: pipeline.defs.textures.normals.binding,
                            resource: this.sceneBuffer.createView(1),
                        },
                    ],
                }),
            ],
        });
    }

    initTestScene() {
        this.sceneBuffer = new RenderTarget(
            this.gpu,
            {
                label: 'scene-one-buffer',
                format: 'bgra8unorm',
                width: this.gpu.canvas.width,
                height: this.gpu.canvas.height,
                depthTexture: true,
                sampleCount: 4,
            },
            [
                {
                    format: 'bgra8unorm',
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                },
                {
                    format: 'rgba16float',
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                },
            ]
        );

        this.sceneOne = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });

        this.camera.position.set(0, 0, 6);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        const geometry = new Box(this.gpu);

        const testMeshPipeline = new RenderPipeline(this.gpu, {
            label: 'simple-cube-render-pipeline',
            vertexBuffers: geometry.bufferLayouts,
            code: cubeShader,
            targets: this.sceneBuffer.getTargets(),
            sampleCount: this.sceneBuffer.sampleCount,
        });

        this.testMesh = new Mesh(this.gpu, {
            label: 'test-mesh',
            pipeline: testMeshPipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: 'simple-box',
                    layout: testMeshPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });

        this.testMesh.setParent(this.sceneOne);

        this.testMesh.position.x = 0.0;
        this.testMesh.position.z = 1.0;

        const testMeshTwoPipeline = new RenderPipeline(this.gpu, {
            label: 'simple-cube-render-pipeline',
            vertexBuffers: geometry.bufferLayouts,
            code: cubeShader,
            targets: this.sceneBuffer.getTargets(),
            sampleCount: this.sceneBuffer.sampleCount,
        });

        this.testMeshTwo = new Mesh(this.gpu, {
            label: 'test-mesh',
            pipeline: testMeshTwoPipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: 'simple-box',
                    layout: testMeshTwoPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });

        this.testMeshTwo.setParent(this.sceneOne);

        this.testMeshTwo.position.x = 0.1;
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        this.orbit.update();
        this.testMesh.rotateX(5.0 * deltaTime);
        this.testMesh.rotateY(1.0 * deltaTime);

        this.testMeshTwo.rotateX(2.0 * deltaTime);
        this.testMeshTwo.rotateY(5.0 * deltaTime);

        this.gpu.renderer.clearColor = { r: 1, g: 1, b: 1, a: 1 };
        this.renderer.render({
            scene: this.sceneOne,
            camera: this.camera,
            target: this.sceneBuffer,
        });
        this.renderer.render({ scene: this.display });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();

        this.sceneBuffer.onResize({
            width: this.gpu.canvas.width,
            height: this.gpu.canvas.height,
        });

        this.display.bindGroups[0] = this.gpu.device.createBindGroup({
            label: 'display-rendering',
            layout: this.displayPipeline.bindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.display.uniformBuffer } },
                {
                    binding: this.displayPipeline.defs.samplers.sampler2d.binding,
                    resource: this.displaySampler,
                },
                {
                    binding: this.displayPipeline.defs.textures.map.binding,
                    resource: this.sceneBuffer.createView(0),
                },
                {
                    binding: this.displayPipeline.defs.textures.normals.binding,
                    resource: this.sceneBuffer.createView(1),
                },
            ],
        });
    };
}
