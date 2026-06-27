import { Camera, Renderer, RenderPipeline, Mesh, Transform, Box } from 'ogpu';
import { GUI } from '@modules/GUI';

import highMeshCountShader from './highmeshcount.wgsl?raw';

// One pipeline, one shared box geometry — every mesh owns its own uniform buffer
// + bind group. Stress test for high draw-call counts; mesh count is live-tunable.
export class HighMeshCount {
    count = 1000;

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
            far: 3000,
        });

        this.scene = new Transform();
        this.geometry = new Box(this.gpu);

        this.pipeline = new RenderPipeline(this.gpu, {
            label: 'high-mesh-count-pipeline',
            code: highMeshCountShader,
            vertexBuffers: this.geometry.bufferLayouts,
        });

        this.meshes = [];
        this.setMeshCount(this.count);

        const gui = new GUI({ title: 'high-mesh-count' });
        gui.add(this, 'count', { min: 1, max: 50000, step: 1, label: 'mesh-count' });
        gui.button('set-mesh-count', () => this.setMeshCount(this.count));

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.gpu.renderer.add(this.update);
    }

    setMeshCount(count) {
        count = parseInt(count) || 1000;

        for (const mesh of this.meshes) this.scene.removeChild(mesh);
        this.meshes = [];

        for (let i = 0; i < count; i++) {
            const mesh = new Mesh(this.gpu, {
                label: `mesh-${i}`,
                pipeline: this.pipeline,
                geometry: this.geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        layout: this.pipeline.bindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    }),
                ],
            });

            mesh.position.set(-100 + Math.random() * 200, -100 + Math.random() * 200, -100 + Math.random() * 200);
            mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            mesh.setParent(this.scene);
            this.meshes.push(mesh);
        }

        this.count = count;
    }

    update = () => {
        const time = performance.now() / 30000;
        this.camera.position.set(Math.sin(time) * 180, 80, Math.cos(time) * 180);
        this.camera.lookAt([0, 0, 0]);

        for (const mesh of this.meshes) {
            mesh.rotation.x += 0.01;
            mesh.rotation.y += 0.01;
        }

        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
