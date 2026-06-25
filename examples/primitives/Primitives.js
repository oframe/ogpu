import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Box, Sphere, Plane, Torus, Cylinder, Disc, Cone, Quad, ThreeDF } from 'ogpu';

import primitivesShader from './primitives.wgsl?raw';

export class Primitives {
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
            fov: 35,
        });
        this.camera.position.set(0, 0, 12);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const geometries = [
            new Box(this.gpu),
            new Sphere(this.gpu),
            new Cylinder(this.gpu),
            new Cone(this.gpu),
            new Torus(this.gpu),
            new Disc(this.gpu),
            new Plane(this.gpu),
            new Quad(this.gpu),
            new ThreeDF(this.gpu),
        ];

        const cols = 3;
        const spacing = 2.4;
        this.meshes = geometries.map((geometry, i) => {
            // per-geometry pipeline: layouts differ (Quad is 2D, rest 3D).
            const pipeline = new RenderPipeline(this.gpu, {
                label: `primitive-pipeline-${i}`,
                code: primitivesShader,
                vertexBuffers: geometry.bufferLayouts,
                cullMode: 'none',
            });

            const mesh = new Mesh(this.gpu, {
                label: `primitive-${i}`,
                pipeline,
                geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        layout: pipeline.bindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    }),
                ],
            });

            const col = i % cols;
            const row = Math.floor(i / cols);
            mesh.position.set((col - 1) * spacing, (1 - row) * spacing, 0);
            mesh.rotation.y = (i / geometries.length) * Math.PI * 2; // staggered start
            // lay the flat ring/disc faces toward camera
            if (geometry instanceof Torus || geometry instanceof Disc) mesh.rotation.x = Math.PI / 2;
            this.scene.addChild(mesh);
            return mesh;
        });

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);

        for (const mesh of this.meshes) mesh.rotation.y += 0.004;

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
