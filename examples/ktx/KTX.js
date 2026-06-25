import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, KTXTexture, Plane } from 'ogpu';

import ktxShader from './ktx.wgsl?raw';

// Port of OGL's "Compressed Textures" example. Loads a block-compressed `.ktx`
// via KTXTexture — picking the first format the device supports, OGL-style —
// and maps it onto a plane.
export class KTX {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(-1, 0.5, 2);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const geometry = new Plane(this.gpu);
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'ktx-pipeline',
            code: ktxShader,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
        });

        // Same uv-grid texture as OGL, in whichever block format this GPU can
        // sample — order by preference like OGL's TextureLoader.
        const f = this.gpu.device.features;
        const { ext, src } = f.has('texture-compression-bc')
            ? { ext: 's3tc', src: './assets/ktx/s3tc-m-y.ktx' }
            : f.has('texture-compression-etc2')
              ? { ext: 'etc', src: './assets/ktx/etc-m-y.ktx' }
              : { ext: 'astc', src: './assets/ktx/astc-m-y.ktx' };

        this.addInfo(`Compressed Textures. Supported format chosen: '${ext}'.`);

        const texture = new KTXTexture(this.gpu, { src });
        await texture.ready;
        const view = texture.createView();

        const sampler = this.gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        this.mesh = new Mesh(this.gpu, {
            label: 'ktx-plane',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: sampler },
                        { binding: 2, resource: view },
                    ],
                }),
            ],
        });
        this.mesh.rotation.x = -Math.PI / 2; // stand the XZ plane up to face the camera
        this.scene.addChild(this.mesh);

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);
        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };

    // Top-left credit overlay, matching OGL's .Info styling.
    addInfo(text) {
        const info = document.createElement('div');
        info.className = 'Info';
        info.textContent = text;
        document.body.appendChild(info);
    }
}
