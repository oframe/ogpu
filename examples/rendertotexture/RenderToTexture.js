import { Box, Mesh, Shader, Renderer, RenderPipeline, Transform, RenderTarget, Camera, Orbit, blit, UniformBuffer, TextureFormat } from 'ogpu';

import display from './display.wgsl?raw';
import cubeShader from './cube.wgsl?raw';

export class RenderToTexture {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
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

        // display.wgsl reads uniforms.resolution; never written here, so it stays zero
        this.displayUniforms = new UniformBuffer(this.gpu, this.displayPipeline.defs.uniforms.uniforms, undefined, { label: 'display-uniforms' });

        this.displayBindGroup = this.buildDisplayBindGroup();
    }

    buildDisplayBindGroup() {
        return this.displayPipeline.bindGroupLayout(0).createBindGroup(
            {
                uniforms: this.displayUniforms,
                sampler2d: this.displaySampler,
                map: this.sceneBuffer.createView(0),
                normals: this.sceneBuffer.createView(1),
            },
            { label: 'display-rendering' }
        );
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

        const shader = new Shader(this.gpu, { label: 'simple-cube', code: cubeShader });

        this.testMesh = new Mesh({ label: 'test-mesh', geometry, shader });

        this.testMesh.setParent(this.sceneOne);

        this.testMesh.position.x = 0.0;
        this.testMesh.position.z = 1.0;

        this.testMeshTwo = new Mesh({ label: 'test-mesh-two', geometry, shader });

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
