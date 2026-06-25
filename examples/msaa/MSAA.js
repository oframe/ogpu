import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Color, Texture, Plane, FullscreenTriangle, RenderTarget, GUI } from 'ogpu';

// Reuse the sort-transparency leaf shader unchanged — same Uniforms struct,
// same green-channel alpha cutout.
import leafShader from '@examples/sorttransparency/sorttransparency.wgsl?raw';
import displayShader from './display.wgsl?raw';

// One leaf rendered into an off-screen RenderTarget whose MSAA sample count is
// swappable from tweakpane, then blitted to the screen so the antialiasing
// (or lack of it at sampleCount 1) is visible on the cutout edges.
export class MSAA {
    constructor() {
        this.params = { sampleCount: 4 };
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
        this.camera.position.set(0, 0, 2.5);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();
        this.geometry = new Plane(this.gpu, { subdivisionsWidth: 10, subdivisionsDepth: 10 });

        const sampler = this.gpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const texture = new Texture(this.gpu, { src: './assets/sorttransparency/leaf.jpg' });
        await texture.ready;
        this.leafSampler = sampler;
        this.leafView = texture.createView();
        this.color = new Color('#ffc219');

        this.buildTarget(this.params.sampleCount);
        this.initDisplay();

        const gui = new GUI({ title: 'msaa' });
        // WebGPU only supports sampleCount 1 or 4 — step:3 snaps the slider to those two.
        gui.add(this.params, 'sampleCount', { label: 'sample-count', min: 1, max: 4, step: 3 }).on('change', ({ value }) => this.buildTarget(value));

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    // sampleCount is baked into both the RenderTarget and the pipeline, so a
    // change tears down and rebuilds the target + scene mesh.
    buildTarget(sampleCount) {
        this.target?.destroy();

        this.target = new RenderTarget(this.gpu, {
            label: 'msaa-target',
            format: 'bgra8unorm',
            width: this.gpu.canvas.width,
            height: this.gpu.canvas.height,
            depthTexture: true,
            sampleCount,
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'msaa-leaf-pipeline',
            code: leafShader,
            vertexBuffers: this.geometry.bufferLayouts,
            targets: this.target.getTargets(),
            sampleCount: this.target.sampleCount,
            cullMode: 'none',
            transparent: true,
            depthWrite: false,
        });

        this.leaf = new Mesh(this.gpu, {
            label: 'leaf',
            pipeline,
            geometry: this.geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: this.leafSampler },
                        { binding: 2, resource: this.leafView },
                    ],
                }),
            ],
        });
        this.leaf.uniforms.set({ color: [this.color[0], this.color[1], this.color[2]] });
        // Plane is XZ (normal +Y) — tilt it up to face the +Z camera, scale to fill.
        this.leaf.rotation.set(-Math.PI / 2 + 0.35, 0, 0);
        this.leaf.scale.set(0.6, 0.6, 0.6);

        this.leafScene = new Transform();
        this.leaf.setParent(this.leafScene);

        // Display samples the resolved color texture — rebind it to the new target.
        if (this.display) this.bindDisplay();
    }

    initDisplay() {
        const geometry = new FullscreenTriangle(this.gpu);

        this.displayPipeline = new RenderPipeline(this.gpu, {
            label: 'msaa-display-pipeline',
            code: displayShader,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
        });
        this.displaySampler = this.gpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        this.display = new Mesh(this.gpu, {
            label: 'msaa-display',
            pipeline: this.displayPipeline,
            geometry,
            bindGroups: () => [this.displayBindGroup()],
        });
    }

    // display.wgsl never reads `uniforms`, so reflection drops binding 0 from the
    // layout — only bind the sampler + resolved color texture.
    displayBindGroup() {
        return this.gpu.device.createBindGroup({
            layout: this.displayPipeline.bindGroupLayout(0),
            entries: [
                { binding: 1, resource: this.displaySampler },
                { binding: 2, resource: this.target.createView(0) },
            ],
        });
    }

    bindDisplay() {
        this.display.bindGroups[0] = this.displayBindGroup();
    }

    update = () => {
        requestAnimationFrame(this.update);

        this.leaf.rotation.z += 0.004;
        this.orbit.update();

        this.gpu.renderer.clearColor = { r: 1, g: 1, b: 1, a: 1 };
        this.renderer.render({ scene: this.leafScene, camera: this.camera, target: this.target });
        this.renderer.render({ scene: this.display });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
        this.target.onResize({ width: this.gpu.canvas.width, height: this.gpu.canvas.height });
        this.bindDisplay();
    };
}
