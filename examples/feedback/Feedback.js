import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Color, Texture, Plane, RenderTarget, createUniformBuffer, blit, TextureFormat } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

import sceneShader from './scene.wgsl?raw';
import feedbackShader from './feedback.wgsl?raw';
import presentShader from './present.wgsl?raw';

const FB_USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

// Motion-trail feedback built on the blit util. Per frame: the falling-leaves
// scene (Sort Transparency's, on black) renders into an offscreen target; a
// feedback blit accumulates it over a decayed copy of the previous frame; a
// present blit shows the result. The two accumulation textures ping-pong — each
// frame the "previous" sample binding and the blit target view swap — so the
// pass never reads and writes the same texture.
export class FeedbackTrails {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.camera = new Camera({ aspect: this.gpu.canvas.width / this.gpu.canvas.height, fov: 35 });
        this.camera.position.set(0, 0, 7);
        this.camera.rotation.z = -0.3;
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        await this.initScene();
        this.initFeedback();

        this.t = 0;

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);
        this.update();
    }

    async initScene() {
        const w = this.gpu.canvas.width;
        const h = this.gpu.canvas.height;

        // scene renders into its own target (black-cleared) so the feedback pass
        // can sample it; depth is needed for the sorted transparent bucket.
        this.sceneTarget = new RenderTarget(this.gpu, { label: 'feedback-scene', width: w, height: h, depthTexture: true }, [{ format: TextureFormat.RGBA16FLOAT, usage: FB_USAGE }]);

        this.scene = new Transform();
        const geometry = new Plane(this.gpu, { subdivisionsWidth: 10, subdivisionsDepth: 10 });

        // shared alpha-blended pipeline (transparent bucket, back-to-front sorted),
        // targeting the offscreen rgba16float buffer.
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'feedback-scene-pipeline',
            code: sceneShader,
            vertexBuffers: geometry.bufferLayouts,
            targets: this.sceneTarget.getTargets(),
            transparent: true,
            depthWrite: false,
            cullMode: 'none',
        });

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
                bindGroups: (uniformResource) => [
                    this.gpu.device.createBindGroup({
                        layout: pipeline.bindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: uniformResource },
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
    }

    initFeedback() {
        this.sampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // color-only fullscreen pass (shared triangle), HDR accumulation buffer
        this.feedbackPipeline = new RenderPipeline(this.gpu, {
            label: 'feedback-accumulate',
            code: feedbackShader,
            vertexBuffers: this.gpu.TRIANGLE.bufferLayouts,
            cullMode: 'none',
            depthStencil: false,
            targets: [{ format: TextureFormat.RGBA16FLOAT }],
        });

        // present the current accumulation to the swapchain
        this.presentPipeline = new RenderPipeline(this.gpu, {
            label: 'feedback-present',
            code: presentShader,
            vertexBuffers: this.gpu.TRIANGLE.bufferLayouts,
            cullMode: 'none',
            depthStencil: false,
        });

        // feedback owns binding 0 (dynamic uniform, per the engine's per-draw model):
        // uDecay drives trail length. present has no uniform at all (see present.wgsl).
        this.feedbackUniforms = makeStructuredView(this.feedbackPipeline.defs.uniforms.uniforms);
        this.feedbackUniformBuffer = createUniformBuffer(this.gpu, { label: 'feedback-uniforms', size: this.feedbackUniforms.arrayBuffer.byteLength });
        this.feedbackUniforms.set({ uDecay: 0.993 });
        this.gpu.device.queue.writeBuffer(this.feedbackUniformBuffer, 0, this.feedbackUniforms.arrayBuffer);

        this.allocFeedbackTextures(this.gpu.canvas.width, this.gpu.canvas.height);
    }

    allocFeedbackTextures(w, h) {
        this.fb?.forEach((t) => t.destroy());
        // two ping-pong accumulation buffers. WebGPU zero-inits textures, so the
        // very first "previous" sample reads black — trails start from nothing.
        this.fb = [
            new Texture(this.gpu, { label: 'feedback-a', width: w, height: h, format: TextureFormat.RGBA16FLOAT, usage: FB_USAGE }),
            new Texture(this.gpu, { label: 'feedback-b', width: w, height: h, format: TextureFormat.RGBA16FLOAT, usage: FB_USAGE }),
        ];
        this.buildBindGroups();
    }

    buildBindGroups() {
        const sceneView = this.sceneTarget.createView(0);
        const fbView = [this.fb[0].createView(), this.fb[1].createView()];
        this.feedbackTargets = fbView;

        // slot t writes fb[t] and samples fb[1-t] as the previous frame
        this.feedbackBindGroups = [0, 1].map((t) =>
            this.gpu.device.createBindGroup({
                layout: this.feedbackPipeline.bindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.feedbackUniformBuffer } },
                    { binding: 1, resource: this.sampler },
                    { binding: 2, resource: sceneView },
                    { binding: 3, resource: fbView[1 - t] },
                ],
            })
        );

        // present slot t shows fb[t] (the one just written this frame). No uniform
        // here — sampler is binding 0, texture binding 1; blit skips the offset.
        this.presentBindGroups = [0, 1].map((t) =>
            this.gpu.device.createBindGroup({
                layout: this.presentPipeline.bindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: fbView[t] },
                ],
            })
        );
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

        // 1) scene -> offscreen target, black background
        this.gpu.renderer.clearColor = { r: 0, g: 0, b: 0, a: 1 };
        this.renderer.render({ scene: this.scene, camera: this.camera, target: this.sceneTarget });

        const t = this.t % 2; // this frame's ping-pong slot
        const encoder = this.gpu.device.createCommandEncoder({ label: 'feedback-encoder' });

        // 2) feedback blit: blend scene over the decayed previous frame -> fb[t]
        blit(encoder, {
            pipeline: this.feedbackPipeline,
            geometry: this.gpu.TRIANGLE,
            targetView: this.feedbackTargets[t],
            bindGroup: this.feedbackBindGroups[t],
            label: 'feedback-accumulate',
        });

        // 3) present blit: fb[t] -> swapchain currentView
        blit(encoder, {
            pipeline: this.presentPipeline,
            geometry: this.gpu.TRIANGLE,
            targetView: this.gpu.getCurrentTexture().createView(),
            bindGroup: this.presentBindGroups[t],
            label: 'feedback-present',
        });

        this.gpu.device.queue.submit([encoder.finish()]);
        this.t++;
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();

        const w = this.gpu.canvas.width;
        const h = this.gpu.canvas.height;
        this.sceneTarget.onResize({ width: w, height: h });
        this.allocFeedbackTextures(w, h);
    };
}
