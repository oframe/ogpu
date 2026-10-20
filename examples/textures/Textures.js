import { Camera, Renderer, Orbit, Shader, Mesh, Geometry, Transform, Texture, VideoTexture, loadJSON, Box } from 'ogpu';

import texturedObj from './texturedObj.wgsl?raw';

export class Textures {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });

        this.camera.position.set(3, 1.5, 4);
        this.camera.lookAt([1, 0.2, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [1, 0.2, 0] });

        this.scene = new Transform();

        const sampler = this.gpu.device.createSampler();

        const data = await loadJSON('./assets/textures/saddle.json');
        const saddleGeo = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                normal: { data: data.normal, numComponents: 3, type: Float32Array },
                uv: { data: data.uv, numComponents: 2, type: Float32Array },
            },
        });

        const shader = new Shader(this.gpu, { label: 'textured-obj', code: texturedObj });
        this.shader = shader;

        const saddleTexture = new Texture(this.gpu, { src: './assets/textures/saddle.jpg' });
        await saddleTexture.ready;
        const saddleView = saddleTexture.createView();

        this.saddle = new Mesh({
            label: 'saddle',
            geometry: saddleGeo,
            shader,
            bindGroups: [shader.bindGroupLayout(0).createBindGroup({ sampler2d: sampler, testTexture: saddleView })],
        });
        this.scene.addChild(this.saddle);

        const boxGeo = new Box(this.gpu);

        this.videoTexture = new VideoTexture(this.gpu, {
            video: './assets/textures/laputa.mp4',
        });
        this.videoSampler = sampler;

        // The video texture doesn't exist until the video's metadata loads, so
        // wire its bind group once it's ready instead of polling every frame.
        this.videoTexture.ready.then((video) => {
            this.videoBox = new Mesh({
                label: 'video-box',
                geometry: boxGeo,
                shader,
                state: { cullMode: 'none' },
                bindGroups: [shader.bindGroupLayout(0).createBindGroup({ sampler2d: this.videoSampler, testTexture: video.createView() })],
            });

            this.videoBox.scale.set(1.78 * 1.5, 1.5, 1.78 * 1.5);
            this.videoBox.position.set(0, 0.5, -4);
            this.scene.addChild(this.videoBox);
        });

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);

        if (this.saddle) this.saddle.rotation.y -= 0.005;
        if (this.videoBox) this.videoBox.rotation.y += 0.003;

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();

        // A video-dimension change swaps the underlying GPUTexture, invalidating
        // the old view. Rebuild the mesh's bind group with the fresh view.
        if (this.videoBox) {
            const view = this.videoTexture.createView();
            if (view) {
                this.videoBox.bindGroups[0] = this.shader.bindGroupLayout(0).createBindGroup({ sampler2d: this.videoSampler, testTexture: view });
            }
        }
    };
}
