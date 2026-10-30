import { Camera, Renderer, Orbit, Shader, Mesh, Transform, Box, CubeMap } from 'ogpu';

import skybox from './skybox.wgsl?raw';

export class CubeMapExample {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;

        this.camera = new Camera({ aspect: this.gpu.canvas.width / this.gpu.canvas.height, fov: 45 });
        this.camera.position.set(-2, 1, -3);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        // Face order is WebGPU/D3D cube order: +X, -X, +Y, -Y, +Z, -Z.
        const cubemap = await new CubeMap(this.gpu, {
            src: ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'].map((f) => `./assets/cubemap/${f}.jpg`),
        }).ready;

        const sampler = this.gpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        const geometry = new Box(this.gpu);
        const shader = new Shader(this.gpu, { label: 'cubemap', code: skybox });
        // both the inside-out skybox and the box are drawn with one state
        const state = { cullMode: 'none' };
        const bindGroups = [shader.bindGroupLayout(0).createBindGroup({ cubeSampler: sampler, tMap: cubemap.view })];

        const makeMesh = (label) => new Mesh({ label, geometry, shader, state, bindGroups });

        this.skybox = makeMesh('skybox');
        this.skybox.scale.set(20, 20, 20);
        this.scene.addChild(this.skybox);

        this.box = makeMesh('box');
        this.scene.addChild(this.box);

        this.renderer.addResizeHandler(this.handleResize);
        this.handleResize();

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);
        this.box.rotation.y += 0.003;
        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
