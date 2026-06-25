import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Geometry, Texture, loadJSON } from 'ogpu';

import instancesShader from './instances.wgsl?raw';

export class Instancing {
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
            fov: 15,
        });
        this.camera.position.set(0, 0, 15);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const data = await loadJSON('./assets/instancing/acorn.json');

        // unique random values per instance — drive rotation, scale and movement.
        const num = 20;
        const offset = new Float32Array(num * 3);
        const random = new Float32Array(num * 3);
        for (let i = 0; i < num; i++) {
            offset.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 3);
            random.set([Math.random(), Math.random(), Math.random()], i * 3);
        }

        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                normal: { data: data.normal, numComponents: 3, type: Float32Array },
                uv: { data: data.uv, numComponents: 2, type: Float32Array },
            },
            instancedData: {
                offset: { data: offset, numComponents: 3 },
                random: { data: random, numComponents: 3 },
            },
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'instanced-acorn-pipeline',
            code: instancesShader,
            vertexBuffers: geometry.bufferLayouts,
        });

        const sampler = this.gpu.device.createSampler();
        const texture = new Texture(this.gpu, { src: './assets/instancing/acorn.jpg' });
        await texture.ready;
        const view = texture.createView();

        this.acorns = new Mesh(this.gpu, {
            label: 'acorns',
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
        this.scene.addChild(this.acorns);

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);

        if (this.acorns) this.acorns.rotation.y -= 0.005;

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
