import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Color, Texture, Plane } from 'ogpu';

import sortTransparencyShader from './sorttransparency.wgsl?raw';

// Several overlapping semi-transparent planes that composite correctly because
// the renderer depth-sorts the transparent bucket back-to-front each frame.
export class SortTransparency {
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
        this.camera.position.set(0, 0, 7);
        this.camera.rotation.z = -0.3;
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        // single subdivided plane shared by every mesh (matches OGL 10x10 Plane)
        const geometry = new Plane(this.gpu, {
            subdivisionsWidth: 10,
            subdivisionsDepth: 10,
        });

        // one alpha-blended pipeline, shared across meshes. `transparent: true`
        // lands every mesh in the renderer's transparent bucket (sorted
        // back-to-front) and gives the pipeline src-alpha / one-minus-src-alpha
        // blending. depthWrite off so far planes don't occlude nearer ones.
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'sort-transparency-pipeline',
            code: sortTransparencyShader,
            vertexBuffers: geometry.bufferLayouts,
            transparent: true,
            depthWrite: false,
            cullMode: 'none',
        });

        // leaf.jpg — same asset as the OGL example; green channel drives alpha.
        const sampler = this.gpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const texture = new Texture(this.gpu, { src: './assets/sorttransparency/leaf.jpg' });
        await texture.ready;
        const view = texture.createView();

        const color = new Color('#ffc219');

        this.meshes = [];
        for (let i = 0; i < 50; i++) {
            const mesh = new Mesh(this.gpu, {
                label: `leaf-${i}`,
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

            mesh.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3);
            mesh.rotation.set(0, (Math.random() - 0.5) * 6.28, (Math.random() - 0.5) * 6.28);
            const s = Math.random() * 0.5 + 0.2;
            mesh.scale.set(s, s, s);
            mesh.speed = Math.random() * 1.5 + 0.2;

            mesh.uniforms.set({ color: [color[0], color[1], color[2]] });

            mesh.setParent(this.scene);
            this.meshes.push(mesh);
        }

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    update = () => {
        requestAnimationFrame(this.update);

        for (const mesh of this.meshes) {
            mesh.rotation.y += 0.05;
            mesh.rotation.z += 0.05;
            mesh.position.y -= 0.02 * mesh.speed;
            if (mesh.position.y < -3) mesh.position.y += 6;
        }

        this.scene.rotation.y += 0.015;

        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
