import { Box, Mesh, Renderer, RenderPipeline, Transform, RenderTarget, Camera, Orbit, blit, createUniformBuffer, TextureFormat } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

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
        this.displayPipeline = new RenderPipeline(this.gpu, {
            label: 'display-pipeline',
            code: display,
            vertexBuffers: this.gpu.TRIANGLE.bufferLayouts,
            cullMode: 'none',
            depthStencil: false, // color-only blit pass, no depth attachment
        });

        this.displaySampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // binding 0 is unused by the fragment shader but the layout still needs
        // a buffer bound there (group(0)/binding(0) is the engine's dynamic slot).
        this.displayUniforms = createUniformBuffer(this.gpu, {
            label: 'display-uniforms',
            size: makeStructuredView(this.displayPipeline.defs.uniforms.uniforms).arrayBuffer.byteLength,
        });

        this.displayBindGroup = this.buildDisplayBindGroup();
    }

    buildDisplayBindGroup() {
        const pipeline = this.displayPipeline;
        return this.gpu.device.createBindGroup({
            label: 'display-rendering',
            layout: pipeline.bindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.displayUniforms } },
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
        });
    }

    initTestScene() {
        this.sceneBuffer = new RenderTarget(
            this.gpu,
            {
                label: 'scene-one-buffer',
                format: TextureFormat.BGRA8UNORM,
                width: this.gpu.canvas.width,
                height: this.gpu.canvas.height,
                depthTexture: true,
                sampleCount: 4,
            },
            [
                {
                    format: TextureFormat.BGRA8UNORM,
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                },
                {
                    format: TextureFormat.RGBA16FLOAT,
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
            bindGroups: (uniformResource) => [
                this.gpu.device.createBindGroup({
                    label: 'simple-box',
                    layout: testMeshPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: uniformResource }],
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
            bindGroups: (uniformResource) => [
                this.gpu.device.createBindGroup({
                    label: 'simple-box',
                    layout: testMeshTwoPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: uniformResource }],
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

        // display pass — blit the two render-target attachments to the swapchain
        const encoder = this.gpu.device.createCommandEncoder({ label: 'display-encoder' });
        blit(encoder, {
            pipeline: this.displayPipeline,
            geometry: this.gpu.TRIANGLE,
            targetView: this.gpu.getCurrentTexture().createView(),
            bindGroup: this.displayBindGroup,
            label: 'display-pass',
        });
        this.gpu.device.queue.submit([encoder.finish()]);
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();

        this.sceneBuffer.onResize({
            width: this.gpu.canvas.width,
            height: this.gpu.canvas.height,
        });

        // sceneBuffer textures were recreated — its views are stale, rebuild
        this.displayBindGroup = this.buildDisplayBindGroup();
    };
}
