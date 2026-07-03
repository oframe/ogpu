import { Renderer, Camera, Transform, Orbit, Mesh, RenderPipeline, Plane, Box, Sphere, Torus, GUI } from 'ogpu';

import { PlanarReflector } from '@modules/reflections/PlanarReflector.js';
import { ReflectionProbe } from '@modules/reflections/ReflectionProbe.js';
import planarShader from '@modules/reflections/planar.wgsl?raw';
import sceneShader from './scene.wgsl?raw';
import probeLitShader from './probelit.wgsl?raw';

// Planar mirrors (floor + wall) with oblique near-plane clipping, glossy blur
// mip chain, and a box-projected ReflectionProbe-lit sphere. The spinning box
// and the column INTERSECT the floor plane — toggle 'oblique-clip' off to see
// their below-floor halves leak into the reflection.
export class Mirrors {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.scene = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
            near: 0.1,
            far: 80,
        });
        this.camera.position.set(6, 3.5, 8);
        this.camera.lookAt([0, 1, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [0, 1, 0] });

        this.initContent();
        this.initMirrors();
        this.initProbe();
        this.initPane();

        this.renderer.addResizeHandler((width, height) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        });

        this.renderer.add(this.update);
    }

    addContentMesh(geometry, { label, color, position = [0, 0, 0], scale = null } = {}) {
        const mesh = new Mesh(this.gpu, {
            label,
            pipeline: this.contentPipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: `${label}-bind-group`,
                    layout: this.contentPipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });
        mesh.uniforms.set({ uColor: color });
        mesh.position.set(...position);
        if (scale) mesh.scale.set(...scale);
        mesh.setParent(this.scene);
        return mesh;
    }

    initContent() {
        const box = new Box(this.gpu);
        const torus = new Torus(this.gpu, { radius: 0.7, thickness: 0.26 });

        // cullMode 'none': winding flips inside mirror/probe renders
        this.contentPipeline = new RenderPipeline(this.gpu, {
            label: 'mirrors-content-pipeline',
            code: sceneShader,
            vertexBuffers: box.bufferLayouts,
            cullMode: 'none',
        });

        this.torus = this.addContentMesh(torus, { label: 'torus', color: [0.85, 0.3, 0.2], position: [-2, 1.2, 0] });
        // both intersect the floor plane — the oblique-clip proof objects
        this.breacher = this.addContentMesh(box, { label: 'breacher-box', color: [0.25, 0.55, 0.85], position: [2, 0, 1] });
        this.column = this.addContentMesh(box, { label: 'column', color: [0.8, 0.7, 0.3], position: [-3.5, 1.2, -2.5], scale: [0.5, 4, 0.5] });
    }

    initMirrors() {
        this.floorReflector = new PlanarReflector(this.gpu, { label: 'floor-reflector', resolutionScale: 1, mipLevels: 6 });
        this.floorReflector.setPlane([0, 1, 0], [0, 0, 0]);

        this.wallReflector = new PlanarReflector(this.gpu, { label: 'wall-reflector', resolutionScale: 1, mipLevels: 6 });
        this.wallReflector.setPlane([0, 0, 1], [0, 0, -4]);

        const floorGeometry = new Plane(this.gpu, { width: 12, depth: 12 });
        const wallGeometry = new Plane(this.gpu, { width: 12, depth: 6 });

        this.planarPipeline = new RenderPipeline(this.gpu, {
            label: 'planar-mirror-pipeline',
            code: planarShader,
            vertexBuffers: floorGeometry.bufferLayouts,
            cullMode: 'none',
        });

        this.floorMirror = new Mesh(this.gpu, {
            label: 'floor-mirror',
            pipeline: this.planarPipeline,
            geometry: floorGeometry,
            bindGroups: (uniformBuffer) => [this.floorReflector.bindGroup(this.planarPipeline, uniformBuffer)],
        });
        this.floorMirror.uniforms.set({
            uBaseColor: [0.05, 0.05, 0.06],
            uRoughness: 0.05,
            uMaxLod: this.floorReflector.maxLod,
            uReflectivity: 0.7,
            uFresnelPower: 5,
        });
        this.floorMirror.setParent(this.scene);
        this.floorReflector.addSurface(this.floorMirror);

        this.wallMirror = new Mesh(this.gpu, {
            label: 'wall-mirror',
            pipeline: this.planarPipeline,
            geometry: wallGeometry,
            bindGroups: (uniformBuffer) => [this.wallReflector.bindGroup(this.planarPipeline, uniformBuffer)],
        });
        this.wallMirror.rotation.x = Math.PI / 2; // plane normal +y -> +z
        this.wallMirror.position.set(0, 3, -4);
        this.wallMirror.uniforms.set({
            uBaseColor: [0.06, 0.06, 0.08],
            uRoughness: 0.15,
            uMaxLod: this.wallReflector.maxLod,
            uReflectivity: 0.85,
            uFresnelPower: 5,
        });
        this.wallMirror.setParent(this.scene);
        this.wallReflector.addSurface(this.wallMirror);

        // resize kills target views (and can shrink the mip chain) — rebuild
        this.floorReflector.addRebuildHandler(() => this.rebindMirror(this.floorMirror, this.floorReflector));
        this.wallReflector.addRebuildHandler(() => this.rebindMirror(this.wallMirror, this.wallReflector));
    }

    rebindMirror(mesh, reflector) {
        mesh.bindGroups[0] = reflector.bindGroup(this.planarPipeline, mesh.uniformBuffer);
        mesh.uniforms.set({ uMaxLod: this.settings.blur ? reflector.maxLod : 0 });
    }

    initProbe() {
        this.probe = new ReflectionProbe(this.gpu, {
            label: 'room-probe',
            size: 128,
            position: [0.8, 1.0, 2.0],
            boxMin: [-6, 0, -4],
            boxMax: [6, 6, 8],
            interval: 0.5,
            far: 60,
        });

        const sphere = new Sphere(this.gpu, { radius: 0.7 });
        this.probePipeline = new RenderPipeline(this.gpu, {
            label: 'probe-lit-pipeline',
            code: probeLitShader,
            vertexBuffers: sphere.bufferLayouts,
            cullMode: 'none',
        });

        this.probeSphere = new Mesh(this.gpu, {
            label: 'probe-lit-sphere',
            pipeline: this.probePipeline,
            geometry: sphere,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: 'probe-lit-bind-group',
                    layout: this.probePipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: this.probePipeline.defs.samplers.probeSampler.binding, resource: this.probe.sampler },
                        { binding: this.probePipeline.defs.textures.tEnv.binding, resource: this.probe.view },
                    ],
                }),
            ],
        });
        this.probeSphere.position.set(...this.probe.position);
        this.probeSphere.uniforms.set({
            uBoxMin: this.probe.boxMin,
            uBoxMax: this.probe.boxMax,
            uProbePos: this.probe.position,
            uBaseColor: [0.04, 0.04, 0.05],
            uRoughness: 0.05,
            uMaxLod: this.probe.mipLevelCount - 1,
            uReflectivity: 0.9,
        });
        this.probeSphere.setParent(this.scene);
    }

    initPane() {
        this.gui = new GUI({ title: 'mirrors', expanded: true });
        this.settings = { resolution: 1, obliqueClip: true, blur: true };

        this.stats = { fps: 0 };
        this.gui.monitor(this.stats, 'fps', { view: 'graph', min: 0, max: 130 });

        const planar = this.gui.folder('planar', { expanded: true });
        planar.add(this.settings, 'resolution', { options: { exact: 1, half: 0.5, quarter: 0.25 }, label: 'resolution-scale' }).on('change', (ev) => {
            this.floorReflector.setResolutionScale(ev.value);
            this.wallReflector.setResolutionScale(ev.value);
        });
        planar.add(this.settings, 'obliqueClip', { label: 'oblique-clip' }).on('change', (ev) => {
            this.floorReflector.obliqueClip = ev.value;
            this.wallReflector.obliqueClip = ev.value;
        });
        planar.add(this.settings, 'blur', { label: 'glossy-blur' }).on('change', (ev) => {
            this.floorReflector.blur = ev.value;
            this.wallReflector.blur = ev.value;
            this.floorMirror.uniforms.set({ uMaxLod: ev.value ? this.floorReflector.maxLod : 0 });
            this.wallMirror.uniforms.set({ uMaxLod: ev.value ? this.wallReflector.maxLod : 0 });
        });
        planar.uniform(this.floorMirror, 'uRoughness', { min: 0, max: 1, step: 0.01, label: 'floor-roughness' });
        planar.uniform(this.wallMirror, 'uRoughness', { min: 0, max: 1, step: 0.01, label: 'wall-roughness' });
        planar.uniform(this.floorMirror, 'uReflectivity', { min: 0, max: 1, step: 0.01, label: 'floor-reflectivity' });

        const probe = this.gui.folder('probe', { expanded: true });
        probe.add(this.probe, 'interval', { min: 0, max: 2, step: 0.05, label: 'update-interval' });
        probe.button('update-now', () => this.probe.invalidate());
        probe.uniform(this.probeSphere, 'uRoughness', { min: 0, max: 1, step: 0.01, label: 'probe-roughness' });
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        if (deltaTime > 0) this.stats.fps += (1 / deltaTime - this.stats.fps) * 0.05;

        this.orbit.update();
        this.torus.rotateY(0.6 * deltaTime);
        this.torus.rotateX(0.3 * deltaTime);
        this.breacher.rotateY(0.5 * deltaTime);

        // probe submits itself (mip generation needs its faces on the queue first)
        this.probe.tick({
            time,
            scene: this.scene,
            renderer: this.renderer,
            hide: [this.probeSphere, this.floorMirror, this.wallMirror],
        });

        // each reflector self-submits (shared-submit passes would clobber each
        // other's mesh uniforms); each mirror hides the other (no recursion)
        this.floorReflector.render({ scene: this.scene, camera: this.camera, renderer: this.renderer, hide: [this.wallMirror] });
        this.wallReflector.render({ scene: this.scene, camera: this.camera, renderer: this.renderer, hide: [this.floorMirror] });
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };
}
