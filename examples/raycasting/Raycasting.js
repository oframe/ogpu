import { Camera, Renderer, Orbit, Raycast, RenderPipeline, Mesh, Transform, Box, Sphere, Quad } from 'ogpu';

import raycastShader from './raycast.wgsl?raw';

export class Raycasting {
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
        this.camera.position.set(2, 1, 5);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const geometries = {
            quad: new Quad(this.gpu),
            sphere: new Sphere(this.gpu),
            cube: new Box(this.gpu),
        };

        const makeMesh = (label, geometry, position) => {
            // per-geometry pipeline: Quad is 2D, sphere/cube 3D — layouts differ.
            const pipeline = new RenderPipeline(this.gpu, {
                label: `raycast-pipeline-${label}`,
                code: raycastShader,
                vertexBuffers: geometry.bufferLayouts,
                cullMode: 'none',
            });
            const mesh = new Mesh(this.gpu, {
                label,
                pipeline,
                geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        layout: pipeline.bindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    }),
                ],
            });
            if (position) mesh.position.set(...position);
            // share a pipeline but keep per-mesh hit state: write uHit just before draw
            mesh.onBeforeRender(({ mesh }) => mesh.uniforms.set({ uHit: mesh.isHit ? 1 : 0 }));
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
        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

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
