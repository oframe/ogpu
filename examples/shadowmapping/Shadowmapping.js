import { Mesh, Renderer, Shader, UniformBuffer, Transform, Camera, Orbit, Plane, RenderTarget, Mat4, Geometry, Texture, loadJSON, TextureFormat } from 'ogpu';

import meshShader from './mesh.wgsl?raw';
import shadow from './shadow.wgsl?raw';

export class Shadowmapping {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
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

        const DEPTH_FORMAT = TextureFormat.DEPTH32FLOAT;
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

        const shadowShader = new Shader(this.gpu, { label: 'shadow-shader', code: shadow });
        const renderShader = new Shader(this.gpu, {
            label: 'render-shader',
            code: meshShader,
            constants: { shadowDepthTextureSize: SHADOW_SIZE },
        });

        const casterState = { depthBias: 1, depthBiasSlopeScale: 1.75 };

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

        const shadowUniforms = new UniformBuffer(this.gpu, renderShader.defs.uniforms.shadowUniforms, { projectionViewMatrix: shadowViewProjectionMatrix }, { label: 'shadow-uniforms' });

        const shadowDepthView = this.shadowBuffer.depthTexture.createView();
        const makeRenderBG = (gpuTexture) =>
            renderShader.bindGroupLayout(0).createBindGroup({
                shadowUniforms,
                shadowSampler: shadowMapSampler,
                shadowMap: shadowDepthView,
                textureSampler: colorSampler,
                tMap: gpuTexture.createView(),
            });

        this.shadowAirplane = new Mesh({
            label: 'shadow-airplane',
            geometry: airplaneGeometry,
            shader: shadowShader,
            state: casterState,
        });

        this.airplane = new Mesh({
            label: 'airplane',
            geometry: airplaneGeometry,
            shader: renderShader,
            bindGroups: [makeRenderBG(airplaneTex.texture)],
        });

        this.floor = new Mesh({
            label: 'floor',
            geometry: floorGeometry,
            shader: renderShader,
            bindGroups: [makeRenderBG(waterTex.texture)],
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
