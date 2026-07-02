import { RenderTarget } from '@core/RenderTarget.js';
import { FullscreenPass } from './FullscreenPass.js';
import blitShader from './blit.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

/**
 * Postprocessing composer. Renders the scene into an HDR MRT target
 * (rgba16float color + world-space normal, depth32float), runs the enabled
 * effects in order through two ping-pong HDR targets, and blits the result to
 * the swapchain — all in a single command-encoder submit.
 *
 * Scene-shader contract: fragment outputs `@location(0)` linear-HDR color and
 * `@location(1)` world-space normal (xyz, .a free). No gamma in scene shaders —
 * the final pass owns the linear→sRGB boundary.
 *
 * MSAA is intentionally not supported through the composer (multisampled depth
 * can't be resolved for AO/SSR); the AA effects replace it.
 */
export class PostProcessing {
    constructor(gpu, { effects = [], format = 'rgba16float', label = 'post' } = {}) {
        this.gpu = gpu;
        this.renderer = gpu.renderer;
        this.label = label;
        this.format = format;

        this.enabled = true;
        this.effects = effects;
        this.quality = 'high';
        this.frameIndex = 0;

        const width = Math.max(2, gpu.canvas.width);
        const height = Math.max(2, gpu.canvas.height);

        this.sceneTarget = new RenderTarget(
            gpu,
            {
                label: `${label}-scene`,
                width,
                height,
                depthTexture: true,
                depthFormat: 'depth32float',
            },
            [
                { format, usage: USAGE, label: 'color' },
                { format: 'rgba16float', usage: USAGE, label: 'normal' },
            ]
        );

        this.pingPong = [0, 1].map(
            (i) =>
                new RenderTarget(gpu, {
                    label: `${label}-pingpong-${i}`,
                    width,
                    height,
                    format,
                    usage: USAGE,
                })
        );

        this.sampler = gpu.device.createSampler({
            label: `${label}-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.blit = new FullscreenPass(gpu, { label: `${label}-blit`, code: blitShader });

        this._views = null;
        this._unsubResize = this.renderer.addResizeHandler((w, h) => this.setSize(w, h));
    }

    // Depth state scene pipelines must use: the composer's scene pass runs
    // against a depth32float attachment, not the renderer's depth24plus — a
    // pipeline built with the engine default fails pass/pipeline validation.
    get depthStencil() {
        return { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    }

    addEffect(effect) {
        this.effects.push(effect);
        return effect;
    }

    setQuality(quality) {
        this.quality = quality;
        this.effects.forEach((e) => e.setQuality?.(quality));
    }

    setSize(width, height) {
        if (!(width > 0 && height > 0)) return;
        this.sceneTarget.onResize({ width, height });
        this.pingPong.forEach((t) => t.onResize({ width, height }));
        // Texture views died with the resize — drop the cache; effects rebuild
        // their bind groups off the fresh views handed to render().
        this._views = null;
        this.effects.forEach((e) => e.resize?.({ width, height }));
    }

    // Views are cached per resize: Texture.createView() mints a new object per
    // call, and stable view identities are what let passes memoize bind groups.
    _ensureViews() {
        if (!this._views) {
            this._views = {
                color: this.sceneTarget.createView(0),
                normal: this.sceneTarget.createView(1),
                depth: this.sceneTarget.depthTexture.createView(),
                pingPong: this.pingPong.map((t) => t.createView(0)),
            };
        }
        return this._views;
    }

    render({ scene, camera } = {}) {
        const { renderer, gpu } = this;

        if (!renderer.isReady || renderer.paused) return;

        const encoder = gpu.device.createCommandEncoder({ label: `${this.label}-encoder` });

        renderer.render({ scene, camera, target: this.sceneTarget, encoder });

        const views = this._ensureViews();
        const size = { width: this.sceneTarget.width, height: this.sceneTarget.height };

        let sourceView = views.color;
        let write = 0;

        // `enabled: false` bypasses the effects, not the pipeline: scene shaders
        // are compiled against the MRT target + depth32float, so the scene must
        // always render through sceneTarget — the blit is an identity passthrough.
        for (const effect of this.enabled ? this.effects : []) {
            if (!effect.enabled) continue;
            const wrote = effect.render(encoder, {
                sourceView,
                destView: views.pingPong[write],
                destTarget: this.pingPong[write],
                depthView: views.depth,
                normalView: views.normal,
                camera,
                size,
                frameIndex: this.frameIndex,
                sampler: this.sampler,
                composer: this,
            });
            // an effect may return false to skip the frame (e.g. async LUTs
            // still loading) — the chain passes through without swapping
            if (wrote === false) continue;
            sourceView = views.pingPong[write];
            write = 1 - write;
        }

        this.blit.setBindings({ tMap: sourceView, blitSampler: this.sampler });
        this.blit.draw(encoder, { view: gpu.getCurrentTexture().createView() });

        gpu.device.queue.submit([encoder.finish()]);
        this.frameIndex++;
    }

    dispose() {
        this._unsubResize?.();
        this.effects.forEach((e) => e.dispose?.());
        this.blit.dispose();
        this.sceneTarget.destroy();
        this.pingPong.forEach((t) => t.destroy());
        this._views = null;
    }
}
