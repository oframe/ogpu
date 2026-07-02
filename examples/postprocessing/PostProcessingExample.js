import {
    Renderer,
    Camera,
    Transform,
    Orbit,
    Mesh,
    RenderPipeline,
    Plane,
    Box,
    Sphere,
    Torus,
    GUI,
    PostProcessing,
    FinalPassEffect,
    BloomEffect,
    BlurEffect,
    FXAAEffect,
    SMAAEffect,
    GTAOEffect,
    SSAOEffect,
    DoFEffect,
} from 'ogpu';

import sceneShader from './scene.wgsl?raw';

const QUALITY_OPTIONS = { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' };

export class PostProcessingExample {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.post = new PostProcessing(this.gpu, { label: 'post' });
        // AO first — it darkens the scene color the rest of the chain reads
        this.gtao = this.post.addEffect(new GTAOEffect(this.gpu));
        this.ssao = this.post.addEffect(new SSAOEffect(this.gpu));
        this.ssao.enabled = false; // cheap-tier alternative to gtao
        this.dof = this.post.addEffect(new DoFEffect(this.gpu, { focusDistance: 12, focusRange: 5 }));
        this.dof.enabled = false;
        this.bloom = this.post.addEffect(new BloomEffect(this.gpu));
        this.blur = this.post.addEffect(new BlurEffect(this.gpu));
        this.blur.enabled = false; // artistic tool — off by default
        this.finalPass = this.post.addEffect(new FinalPassEffect(this.gpu));
        // AA runs on LDR output, after the final pass; pick one at a time
        this.fxaa = this.post.addEffect(new FXAAEffect(this.gpu));
        this.smaa = this.post.addEffect(new SMAAEffect(this.gpu));
        this.smaa.enabled = false;

        this.scene = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
            near: 0.1,
            far: 80,
        });
        this.camera.position.set(7, 4.5, 9);
        this.camera.lookAt([0, 0.8, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [0, 0.8, 0] });

        this.initScene();
        this.initPane();

        this.renderer.addResizeHandler((width, height) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        });

        this.renderer.add(this.update);
    }

    addMesh(geometry, { label, color, emissive = [0, 0, 0], emissiveIntensity = 0, position = [0, 0, 0] } = {}) {
        const mesh = new Mesh(this.gpu, {
            label,
            pipeline: this.pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: `${label}-bind-group`,
                    layout: this.pipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });
        mesh.uniforms.set({ uColor: color, uEmissive: emissive, uEmissiveIntensity: emissiveIntensity });
        mesh.position.set(...position);
        mesh.setParent(this.scene);
        return mesh;
    }

    initScene() {
        const box = new Box(this.gpu);
        const sphere = new Sphere(this.gpu, { radius: 0.6 });
        const torus = new Torus(this.gpu, { radius: 0.7, thickness: 0.26 });
        const floor = new Plane(this.gpu, { width: 40, depth: 40 });

        // One pipeline shared by every mesh — same layout, same MRT targets.
        this.pipeline = new RenderPipeline(this.gpu, {
            label: 'post-scene-pipeline',
            code: sceneShader,
            vertexBuffers: box.bufferLayouts,
            targets: this.post.sceneTarget.getTargets(),
            depthStencil: this.post.depthStencil,
        });

        this.addMesh(floor, { label: 'floor', color: [0.42, 0.42, 0.45] });

        // Depth spread for DoF/SSR later: a loose diagonal of primitives.
        this.spinners = [
            this.addMesh(torus, { label: 'torus-a', color: [0.85, 0.3, 0.2], position: [0, 1.0, 0] }),
            this.addMesh(box, { label: 'box-a', color: [0.25, 0.55, 0.85], position: [-2.6, 0.5, -1.8] }),
            this.addMesh(torus, { label: 'torus-b', color: [0.3, 0.75, 0.4], position: [2.8, 0.9, -3.2] }),
            this.addMesh(box, { label: 'box-b', color: [0.8, 0.7, 0.3], position: [4.4, 0.5, 2.2] }),
        ];

        this.addMesh(sphere, { label: 'sphere-a', color: [0.9, 0.88, 0.85], position: [-4.2, 0.6, 2.6] });
        this.addMesh(sphere, { label: 'sphere-b', color: [0.2, 0.2, 0.22], position: [1.8, 0.6, 3.4] });

        // Emissive HDR spheres — bloom / selective-bloom subjects.
        this.emissives = [
            this.addMesh(sphere, { label: 'emissive-orange', color: [0.1, 0.05, 0.02], emissive: [1.0, 0.45, 0.12], emissiveIntensity: 6, position: [-1.6, 0.6, 1.6] }),
            this.addMesh(sphere, { label: 'emissive-cyan', color: [0.02, 0.06, 0.08], emissive: [0.15, 0.8, 1.0], emissiveIntensity: 6, position: [2.2, 0.6, -0.8] }),
            this.addMesh(sphere, { label: 'emissive-magenta', color: [0.08, 0.02, 0.07], emissive: [1.0, 0.2, 0.85], emissiveIntensity: 6, position: [-3.4, 0.6, -3.0] }),
        ];
    }

    initPane() {
        this.gui = new GUI({ title: 'postprocessing', expanded: true });

        this.gui.add(this.post, 'enabled', { label: 'post-enabled' });

        const proxy = { quality: this.post.quality, emissive: 6 };
        this.gui.add(proxy, 'quality', { options: QUALITY_OPTIONS }).on('change', (ev) => this.post.setQuality(ev.value));
        this.gui.add(proxy, 'emissive', { min: 0, max: 20, step: 0.1, label: 'emissive-intensity' }).on('change', (ev) => {
            this.emissives.forEach((m) => m.uniforms.set({ uEmissiveIntensity: ev.value }));
        });

        this.gtao.addGUI(this.gui);
        this.ssao.addGUI(this.gui);
        this.dof.addGUI(this.gui);
        this.bloom.addGUI(this.gui);
        this.blur.addGUI(this.gui);
        this.finalPass.addGUI(this.gui);
        this.fxaa.addGUI(this.gui);
        this.smaa.addGUI(this.gui);
    }

    update = ({ deltaTime = 0 } = {}) => {
        this.orbit.update();

        this.spinners.forEach((mesh, i) => {
            mesh.rotateY((0.4 + i * 0.15) * deltaTime);
            mesh.rotateX(0.25 * deltaTime);
        });

        this.post.render({ scene: this.scene, camera: this.camera });
    };
}
