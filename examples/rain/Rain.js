import { Camera, Renderer, Transform, Orbit, GUI, Mesh, Plane, Sphere, Box, RenderPipeline, Vec3, PerformanceProfile } from 'ogpu';
import { RainSystem } from '@modules/rain/RainSystem.js';

import groundShader from './ground.wgsl?raw';
import meshShader from './mesh.wgsl?raw';

// Rain demo: velocity-stretched streaks in a camera-following wrap volume +
// a ground plane sampling the RippleField texture (tRipple) for impact
// ripples, plus a sphere and a box in the scene that sample the same
// ripple field on their upward-facing surfaces and go wet/glossy with rain
// intensity. Preset dropdown + intensity slider in the GUI.
export class Rain {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 50,
        });
        this.camera.position.set(0, 2.2, 7);
        this.camera.lookAt([0, 0.5, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: new Vec3(0, 0.5, 0) });

        this.scene = new Transform();
        this.renderer.setClearColor({ r: 0.008, g: 0.01, b: 0.016 });

        this.rain = new RainSystem(this.gpu, { preset: 'heavy' });
        this.scene.addChild(this.rain);

        this.initGround();
        this.initMeshes();

        this.gui = new GUI({ title: 'rain', expanded: true });
        this.rain.addGUI(this.gui);
        this.gui.uniform(this.ground, 'uRippleStrength', { label: 'ripple-strength', min: 0, max: 8, step: 0.05 });

        this.profile = await PerformanceProfile.detect(this.gpu);
        this.rain.setQuality(this.profile.quality);
        this.profile.onQualityChange((q) => this.rain.setQuality(q));

        this.renderer.addResizeHandler(this.handleResize);
        this.handleResize();

        this.renderer.add(this.update);
    }

    initGround() {
        const geometry = new Plane(this.gpu, { width: 40, depth: 40 });
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'rain-ground-pipeline',
            code: groundShader,
            vertexBuffers: geometry.bufferLayouts,
        });

        const sampler = this.gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        this.ground = new Mesh(this.gpu, {
            label: 'rain-ground',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: 'rain-ground-bind-group',
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: sampler },
                        { binding: 2, resource: this.rain.tRipple },
                    ],
                }),
            ],
        });

        this.ground.uniforms.set({
            uRippleWorldSize: this.rain.rippleWorldSize,
            uRippleStrength: 3,
        });

        this.scene.addChild(this.ground);
    }

    // Sphere + box that sit on the ground and react to the same ripple
    // field: normals bend on their upward-facing surfaces, and the surface
    // goes wet (darker albedo, glossier specular) as rain intensity rises.
    initMeshes() {
        const sampler = this.gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        const makeMesh = ({ label, geometry, position, color }) => {
            const pipeline = new RenderPipeline(this.gpu, {
                label: `${label}-pipeline`,
                code: meshShader,
                vertexBuffers: geometry.bufferLayouts,
            });

            const mesh = new Mesh(this.gpu, {
                label,
                pipeline,
                geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        label: `${label}-bind-group`,
                        layout: pipeline.bindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniformBuffer } },
                            { binding: 1, resource: sampler },
                            { binding: 2, resource: this.rain.tRipple },
                        ],
                    }),
                ],
            });

            mesh.position.set(...position);
            mesh.uniforms.set({
                uRippleWorldSize: this.rain.rippleWorldSize,
                uRippleStrength: 3,
                uWetness: 0,
                uColor: color,
            });

            this.scene.addChild(mesh);
            return mesh;
        };

        this.sphere = makeMesh({
            label: 'rain-sphere',
            geometry: new Sphere(this.gpu, { radius: 0.8 }),
            position: [-1.6, 0.8, -1],
            color: [0.6, 0.15, 0.15],
        });

        this.box = makeMesh({
            label: 'rain-box',
            geometry: new Box(this.gpu, { size: 1.2 }),
            position: [1.6, 0.6, 0.5],
            color: [0.18, 0.25, 0.55],
        });
    }

    update = ({ deltaTime }) => {
        this.rain.update(null, { dt: Math.min(deltaTime, 0.05), camera: this.camera });
        // wetness tracks live rain intensity (GUI-driven)
        this.sphere.uniforms.set({ uWetness: this.rain.intensity });
        this.box.uniforms.set({ uWetness: this.rain.intensity });
        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        if (!this.renderer.canvas.height) return;
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
