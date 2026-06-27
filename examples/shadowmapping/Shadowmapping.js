import { Mesh, Renderer, RenderPipeline, Transform, Camera, Orbit, Plane, RenderTarget, Mat4, Geometry, Texture, loadJSON, createUniformBuffer } from 'ogpu';

import cubeShader from './cube.wgsl?raw';
import shadow from './shadow.wgsl?raw';
import { makeStructuredView } from 'webgpu-utils';

export class Shadowmapping {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 35,
            near: 0.1,
            far: 100,
        });
        this.camera.position.set(5, 4, 10);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const DEPTH_FORMAT = 'depth32float';
        const SHADOW_SIZE = 2048;

        this.shadowBuffer = new RenderTarget(this.gpu, {
            width: SHADOW_SIZE,
            height: SHADOW_SIZE,
            depth: 1,
            color: false,
            depthTexture: true,
            depthFormat: DEPTH_FORMAT,
        });

        const size = 3;
        this.shadowCamera = new Camera({
            left: -size,
            right: size,
            top: size,
            bottom: -size,
            near: 1,
            far: 20,
        });
        this.shadowCamera.position.set(3, 10, 3);
        this.shadowCamera.lookAt([0, 0, 0]);
        this.shadowCamera.updateMatrixWorld();

        const shadowViewProjectionMatrix = new Mat4().copy(this.shadowCamera.projectionMatrix).multiply(this.shadowCamera.viewMatrix);

        // load airplane mesh + textures in parallel
        const airplaneTex = new Texture(this.gpu, { src: './assets/shadowmapping/airplane.jpg', mips: true });
        const waterTex = new Texture(this.gpu, { src: './assets/shadowmapping/water.jpg', mips: true });

        const [jsonData] = await Promise.all([loadJSON('./assets/shadowmapping/airplane.json'), airplaneTex.ready, waterTex.ready]);

        // airplane.json uv's are top-left origin; flip v to match WebGPU's bottom-left sampling
        const airplaneUV = Float32Array.from(jsonData.uv, (val, i) => (i % 2 ? 1 - val : val));

        const airplaneGeometry = new Geometry(this.gpu, {
            data: {
                position: { data: new Float32Array(jsonData.position), numComponents: 3 },
                normal: { data: new Float32Array(jsonData.normal), numComponents: 3 },
                uv: { data: airplaneUV, numComponents: 2 },
            },
        });

        const floorGeometry = new Plane(this.gpu, { width: 6, depth: 6 });

        // airplane and floor share the same attribute layout (pos/normal/uv, interleaved,
        // stride 32). Since we know that upfront, declare the vertex layout once and hand it
        // to both pipelines — rather than borrowing one geometry's `.bufferLayouts` and
        // implicitly assuming every other geometry the pipeline draws happens to match.
        const vertexLayout = [
            {
                arrayStride: 32,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                    { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
                    { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
                ],
            },
        ];

        const shadowPipeline = new RenderPipeline(this.gpu, {
            label: 'shadow-pipeline',
            code: shadow,
            vertexBuffers: vertexLayout,
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: DEPTH_FORMAT,
                depthBias: 1,
                depthBiasSlopeScale: 1.75,
                depthBiasClamp: 0.0,
            },
        });

        const renderPipeline = new RenderPipeline(this.gpu, {
            label: 'render-pipeline',
            code: cubeShader,
            vertexBuffers: vertexLayout,
            cullMode: 'back',
            constants: { shadowDepthTextureSize: SHADOW_SIZE },
        });

        const shadowMapSampler = this.gpu.device.createSampler({
            label: 'shadow-map-sampler',
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            compare: 'less',
        });

        const colorSampler = this.gpu.device.createSampler({
            label: 'color-sampler',
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        const shadowView = makeStructuredView(renderPipeline.defs.uniforms.shadowUniforms);

        const shadowUniformBuffer = createUniformBuffer(this.gpu, {
            label: 'shadow-uniform-buffer',
            size: shadowViewProjectionMatrix.byteLength,
        });

        shadowView.set({ projectionViewMatrix: shadowViewProjectionMatrix });
        this.gpu.device.queue.writeBuffer(shadowUniformBuffer, 0, shadowView.arrayBuffer);

        const makeRenderBG = (uniformBuffer, gpuTexture) =>
            this.gpu.device.createBindGroup({
                layout: renderPipeline.bindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: shadowUniformBuffer } },
                    { binding: 2, resource: shadowMapSampler },
                    { binding: 3, resource: this.shadowBuffer.depthTexture.createView() },
                    { binding: 4, resource: colorSampler },
                    { binding: 5, resource: gpuTexture.createView() },
                ],
            });

        this.shadowAirplane = new Mesh(this.gpu, {
            label: 'shadow-airplane',
            pipeline: shadowPipeline,
            geometry: airplaneGeometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: shadowPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });

        this.airplane = new Mesh(this.gpu, {
            label: 'airplane',
            pipeline: renderPipeline,
            geometry: airplaneGeometry,
            bindGroups: (uniformBuffer) => [makeRenderBG(uniformBuffer, airplaneTex.texture)],
        });

        this.floor = new Mesh(this.gpu, {
            label: 'floor',
            pipeline: renderPipeline,
            geometry: floorGeometry,
            bindGroups: (uniformBuffer) => [makeRenderBG(uniformBuffer, waterTex.texture)],
        });

        this.floor.position.y = -3;

        this.airplane.setParent(this.scene);
        this.floor.setParent(this.scene);

        addEventListener('resize', this.handleResize);
        setTimeout(() => this.handleResize(), 150);

        this.gpu.renderer.add(this.update);
    }

    update = ({ time }) => {
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.airplane.position.z = Math.sin(time);
        this.airplane.rotation.x = Math.sin(time + 2) * 0.1;
        this.airplane.rotation.y = Math.sin(time - 4) * -0.1;

        this.shadowAirplane.quaternion.copy(this.airplane.quaternion);
        this.shadowAirplane.position.copy(this.airplane.position);

        this.renderer.render({
            scene: this.shadowAirplane,
            camera: this.shadowCamera,
            target: this.shadowBuffer,
        });

        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
