import { Renderer, Camera, Transform, ComputeShader, Orbit, GLTFLoader, createUniformBuffer, loadIBLCubeMap, loadSphericalHarmonics } from 'ogpu';

import pbr from '@modules/pbr/pbr.wgsl?raw';
import brdflut from '@modules/pbr/brdflut.wgsl?raw';

export class GLTF {
    constructor(canvas) {
        this.init(canvas);
    }

    async init(canvas) {
        canvas = canvas || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.scene = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
            far: 100,
        });
        this.camera.position.set(0, 0, 4);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        const ibl = await this.initIBL();

        const iblSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });

        const iblEntries = [
            { binding: 1, resource: ibl.specView },
            { binding: 2, resource: { buffer: ibl.shBuffer } },
            { binding: 3, resource: ibl.lutTexture.createView() },
            { binding: 4, resource: iblSampler },
        ];

        const model = window.location.search.split('model=')[1] || 'DamagedHelmet.glb';

        this.loader = new GLTFLoader(this.gpu, {
            code: pbr,
            iblEntries,
            constants: { roughnessLevels: ibl.mipLevels },
        });

        const root = await this.loader.load(`./assets/gltf/${model}`);
        root.setParent(this.scene);

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.gpu.renderer.add(this.update);
    }

    async initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.json' } = {}) {
        const ibl = await loadIBLCubeMap(this.gpu, {
            url,
            faceSize: 256,
            mipLevels: 6,
            label: 'gltf-specular-ibl',
        });

        const shArray = await loadSphericalHarmonics(shUrl);
        const shBuffer = createUniformBuffer(this.gpu, {
            label: 'gltf-sh-constants-buffer',
            size: shArray.byteLength,
        });
        this.gpu.device.queue.writeBuffer(shBuffer, 0, shArray);

        const lutTexture = this.gpu.device.createTexture({
            size: [512, 512],
            format: 'rgba16float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            label: 'gltf-brdflut-texture',
        });

        const brdflutCompute = new ComputeShader(this.gpu, {
            label: 'gltf-brdflut-compute',
            code: brdflut,
        });
        const bindGroup = this.gpu.device.createBindGroup({
            label: 'gltf-brdflut-bind-group',
            layout: brdflutCompute.bindGroupLayout(brdflutCompute.findKernel('main')),
            entries: [{ binding: 0, resource: lutTexture.createView() }],
        });

        const encoder = this.gpu.device.createCommandEncoder({ label: 'gltf-brdflut-encoder' });
        const pass = encoder.beginComputePass({ label: 'gltf-brdflut-pass' });
        brdflutCompute.dispatch(encoder, {
            pass,
            kernel: brdflutCompute.findKernel('main'),
            bindGroup,
            dispatchCount: [512, 512, 1],
        });
        pass.end();
        this.gpu.device.queue.submit([encoder.finish()]);

        return { specView: ibl.view, mipLevels: ibl.mipLevels, shBuffer, lutTexture };
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        this.renderer.setClearColor({ r: 0.02, g: 0.02, b: 0.03 });
        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
