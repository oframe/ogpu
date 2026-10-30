import { Camera, Renderer, Orbit, Raycast, Shader, UniformBuffer, Mesh, Transform, Box, Sphere, Quad } from 'ogpu';

import raycastShader from './raycast.wgsl?raw';

export class Raycasting {
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
        this.camera.position.set(2, 1, 5);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const geometries = {
            quad: new Quad(this.gpu),
            sphere: new Sphere(this.gpu),
            cube: new Box(this.gpu),
        };

        const shader = new Shader(this.gpu, { label: 'raycast-shader', code: raycastShader });
        const state = { cullMode: 'none' };

        const makeMesh = (label, geometry, position) => {
            // own hit-state buffer per mesh; the renderer derives a pipeline per geometry layout
            const hit = new UniformBuffer(this.gpu, shader.uniforms, { uHit: 0 }, { label: `${label}-hit` });
            const mesh = new Mesh({
                label,
                geometry,
                shader,
                state,
                bindGroups: [shader.bindGroupLayout(0).createBindGroup({ uniforms: hit })],
            });
            if (position) mesh.position.set(...position);
            mesh.onBeforeRender(({ mesh }) => hit.set({ uHit: mesh.isHit ? 1 : 0 }));
            mesh.setParent(this.scene);
            return mesh;
        };

        const quad = makeMesh('quad', geometries.quad, [0, 1.3, 0]);
        const sphere = makeMesh('sphere', geometries.sphere, null);
        const cube = makeMesh('cube', geometries.cube, [0, -1.3, 0]);

        quad.scale.set(0.5, 0.5, 0.5);
        sphere.scale.set(0.5, 0.5, 0.5);

        // Prefer bounding-sphere test for the sphere; box AABB for the rest.
        sphere.geometry.raycast = 'sphere';

        this.meshes = [quad, sphere, cube];
        this.raycast = new Raycast();

        addEventListener('mousemove', this.handleMove);
        this.renderer.addResizeHandler(this.handleResize);
        this.handleResize();

        this.update();
    }

    handleMove = (e) => {
        const w = this.renderer.canvas.clientWidth;
        const h = this.renderer.canvas.clientHeight;
        const ndc = [(2.0 * e.clientX) / w - 1.0, 2.0 * (1.0 - e.clientY / h) - 1.0];

        this.raycast.castMouse(this.camera, ndc);
        this.meshes.forEach((m) => (m.isHit = false));
        this.raycast.intersectBounds(this.meshes).forEach((m) => (m.isHit = true));
    };

    update = () => {
        requestAnimationFrame(this.update);
        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
