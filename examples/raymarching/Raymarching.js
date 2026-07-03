// SDF raymarching among raster meshes, depth-composited through the post stack.
// The orbiting raster cube passes THROUGH the metaball cluster — the SDF surface
// both occludes it and is occluded by it (frag_depth proof). GTAO reads the
// SDF's depth/normal outputs like any geometry; TAA jitter feeds the ray setup.

import { Renderer, Camera, Transform, Orbit, Mesh, RenderPipeline, Box, Plane, GUI, PostProcessing, FinalPassEffect, BloomEffect, GTAOEffect, TAAEffect, PerformanceProfile, loadIBLCubeMap } from 'ogpu';

import { Raymarcher } from '@modules/raymarch/Raymarcher.js';
import sceneShader from './scene.wgsl?raw';

export class Raymarching {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.post = new PostProcessing(this.gpu, { label: 'post' });
        this.gtao = this.post.addEffect(new GTAOEffect(this.gpu));
        this.taa = this.post.addEffect(new TAAEffect(this.gpu));
        this.bloom = this.post.addEffect(new BloomEffect(this.gpu, { intensity: 0.4 }));
        this.finalPass = this.post.addEffect(new FinalPassEffect(this.gpu));

        this.scene = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
            near: 0.1,
            far: 60,
        });
        this.camera.position.set(6, 3.5, 8);
        this.camera.lookAt([0, 1, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [0, 1, 0] });

        const ibl = await loadIBLCubeMap(this.gpu, {
            url: './assets/pbr/artistworkshop_oct.exr',
            faceSize: 256,
            mipLevels: 6,
            label: 'raymarch-ibl',
        });

        this.raymarcher = new Raymarcher(this.gpu, { post: this.post, ibl, preset: 'metaballs' });
        this.scene.addChild(this.raymarcher);

        this.profile = await PerformanceProfile.detect(this.gpu);
        this.post.setQuality(this.profile.quality);
        this.raymarcher.setQuality(this.profile.quality);
        this.profile.onQualityChange((quality) => {
            this.post.setQuality(quality);
            this.raymarcher.setQuality(quality);
        });

        this.initScene();
        this.initPane();

        this.renderer.addResizeHandler((width, height) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        });

        this.renderer.add(this.update);
    }

    addMesh(geometry, { label, color, position = [0, 0, 0] } = {}) {
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
        mesh.uniforms.set({ uColor: color });
        mesh.position.set(...position);
        mesh.setParent(this.scene);
        return mesh;
    }

    initScene() {
        const box = new Box(this.gpu);
        const floor = new Plane(this.gpu, { width: 30, depth: 30 });

        this.pipeline = new RenderPipeline(this.gpu, {
            label: 'raymarch-scene-pipeline',
            code: sceneShader,
            vertexBuffers: box.bufferLayouts,
            targets: this.post.sceneTarget.getTargets(),
            depthStencil: this.post.depthStencil,
        });

        this.addMesh(floor, { label: 'floor', color: [0.42, 0.42, 0.45] });
        // occlusion probe: orbits through the metaball cluster every few seconds
        this.cube = this.addMesh(box, { label: 'occluder-cube', color: [0.25, 0.55, 0.85], position: [1.4, 1.2, 0] });
        this.addMesh(box, { label: 'box-far', color: [0.8, 0.7, 0.3], position: [3.4, 0.5, -2.4] });
    }

    initPane() {
        this.gui = new GUI({ title: 'raymarching', expanded: true });

        this.stats = { fps: 0 };
        this.gui.monitor(this.stats, 'fps', { view: 'graph', min: 0, max: 130 });

        this.gui.add(this.post, 'enabled', { label: 'post-enabled' });
        this.profile.addGUI(this.gui);
        this.raymarcher.addGUI(this.gui);
        this.gtao.addGUI(this.gui);
        this.taa.addGUI(this.gui);
        this.bloom.addGUI(this.gui);
        this.finalPass.addGUI(this.gui);
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        if (deltaTime > 0) this.stats.fps += (1 / deltaTime - this.stats.fps) * 0.05;

        this.orbit.update();

        // sweep the cube through the SDF cluster so both occlusion directions show
        const a = time * 0.4;
        this.cube.position.set(Math.cos(a) * 1.6, 1.2, Math.sin(a) * 1.6);
        this.cube.rotateY(deltaTime * 0.6);

        this.post.render({ scene: this.scene, camera: this.camera });
    };
}
