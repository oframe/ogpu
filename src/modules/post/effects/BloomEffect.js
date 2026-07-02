import { RenderTarget } from '@core/RenderTarget.js';
import { FullscreenPass } from '../FullscreenPass.js';
import prefilterShader from './bloom_prefilter.wgsl?raw';
import downShader from './bloom_down.wgsl?raw';
import upShader from './bloom_up.wgsl?raw';
import compositeShader from './bloom_composite.wgsl?raw';
import kawaseDownShader from './blur_kawase_down.wgsl?raw';
import kawaseUpShader from './blur_kawase_up.wgsl?raw';
import gaussianShader from './blur_gaussian.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
const ADD_BLEND = {
    color: { srcFactor: 'one', dstFactor: 'one' },
    alpha: { srcFactor: 'one', dstFactor: 'one' },
};

const QUALITY = {
    low: { mips: 3, iterations: 1 },
    medium: { mips: 4, iterations: 1 },
    high: { mips: 5, iterations: 2 },
    ultra: { mips: 7, iterations: 3 },
};

export const BLOOM_MODES = ['unreal', 'classic', 'kawase'];
export const BLOOM_MASKS = { none: 0, 'color-key': 1 };

/**
 * HDR bloom, three flavors on one half-res mip chain:
 * - `unreal`  — 13-tap downsample + additive 9-tap tent upsample (convolution
 *               bloom à la CoD/Unreal), soft-knee threshold.
 * - `classic` — threshold + iterated separable gaussian at half res.
 * - `kawase`  — dual-filter Kawase down/up, the mobile-tier option.
 * Selective bloom via the prefilter mask: `luminance` (plain threshold) or
 * `color-key` (chroma proximity to a picked color).
 */
export class BloomEffect {
    constructor(gpu, { format = 'rgba16float', mode = 'unreal', intensity = 0.7, threshold = 1.0, knee = 0.5, radius = 1.0 } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.format = format;
        this.mode = mode;
        this.mips = QUALITY.high.mips;
        this._iterations = QUALITY.high.iterations;

        this._chain = [];
        this._chainViews = [];
        this._size = { width: 0, height: 0 };

        const targets = [{ format }];

        this.prefilter = new FullscreenPass(gpu, { label: 'bloom-prefilter', code: prefilterShader, targets });
        this.prefilter.uniforms.set({ threshold, knee, maskMode: 0, keyColor: [1, 1, 1], tolerance: 0.35, karis: 1 });

        this.down = new FullscreenPass(gpu, { label: 'bloom-down', code: downShader, targets });
        this.up = new FullscreenPass(gpu, { label: 'bloom-up', code: upShader, targets, blending: ADD_BLEND });
        this.up.uniforms.set({ radius });

        this.kawaseDown = new FullscreenPass(gpu, { label: 'bloom-kawase-down', code: kawaseDownShader, targets });
        this.kawaseDown.uniforms.set({ offset: 1 });
        this.kawaseUp = new FullscreenPass(gpu, { label: 'bloom-kawase-up', code: kawaseUpShader, targets });
        this.kawaseUp.uniforms.set({ offset: 1 });

        this.blurH = new FullscreenPass(gpu, { label: 'bloom-blur-h', code: gaussianShader, targets });
        this.blurH.uniforms.set({ direction: [1, 0], radius: 4, mixAmount: 1 });
        this.blurV = new FullscreenPass(gpu, { label: 'bloom-blur-v', code: gaussianShader, targets });
        this.blurV.uniforms.set({ direction: [0, 1], radius: 4, mixAmount: 1 });

        this.composite = new FullscreenPass(gpu, { label: 'bloom-composite', code: compositeShader, targets });
        this.composite.uniforms.set({ intensity, tint: [1, 1, 1] });
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this.mips = q.mips;
        this._iterations = q.iterations;
    }

    resize() {
        this._size = { width: 0, height: 0 }; // rebuild chain on next render
    }

    _disposeChain() {
        this._chain.forEach((t) => t.destroy());
        this._temp?.destroy?.();
        this._chain = [];
        this._chainViews = [];
        this._temp = null;
    }

    _ensureChain(size) {
        if (this._size.width === size.width && this._size.height === size.height && this._chain.length === this.mips) return;
        this._disposeChain();
        this._size = { width: size.width, height: size.height };

        let w = size.width;
        let h = size.height;
        for (let i = 0; i < this.mips; i++) {
            w = Math.max(4, w >> 1);
            h = Math.max(4, h >> 1);
            this._chain.push(new RenderTarget(this.gpu, { label: `bloom-mip-${i}`, width: w, height: h, format: this.format, usage: USAGE }));
        }
        this._chainViews = this._chain.map((t) => t.createView(0));

        // classic-mode gaussian ping buffer, same size as mip 0
        this._temp = new RenderTarget(this.gpu, {
            label: 'bloom-blur-temp',
            width: this._chain[0].width,
            height: this._chain[0].height,
            format: this.format,
            usage: USAGE,
        });
        this._tempView = this._temp.createView(0);
    }

    render(encoder, { sourceView, destView, sampler, size }) {
        this._ensureChain(size);
        const views = this._chainViews;
        const last = views.length - 1;

        this.prefilter.setBindings({ tMap: sourceView, mapSampler: sampler }, 'pre');
        this.prefilter.draw(encoder, { view: views[0], bindKey: 'pre' });

        if (this.mode === 'unreal') {
            for (let i = 1; i <= last; i++) {
                this.down.setBindings({ tMap: views[i - 1], mapSampler: sampler }, `d${i}`);
                this.down.draw(encoder, { view: views[i], bindKey: `d${i}` });
            }
            for (let i = last - 1; i >= 0; i--) {
                this.up.setBindings({ tMap: views[i + 1], mapSampler: sampler }, `u${i}`);
                this.up.draw(encoder, { view: views[i], bindKey: `u${i}`, loadOp: 'load' });
            }
        } else if (this.mode === 'kawase') {
            for (let i = 1; i <= last; i++) {
                this.kawaseDown.setBindings({ tMap: views[i - 1], mapSampler: sampler }, `d${i}`);
                this.kawaseDown.draw(encoder, { view: views[i], bindKey: `d${i}` });
            }
            for (let i = last - 1; i >= 0; i--) {
                this.kawaseUp.setBindings({ tMap: views[i + 1], mapSampler: sampler }, `u${i}`);
                this.kawaseUp.draw(encoder, { view: views[i], bindKey: `u${i}` });
            }
        } else {
            for (let k = 0; k < this._iterations; k++) {
                this.blurH.setBindings({ tMap: views[0], tSource: views[0], mapSampler: sampler }, 'h');
                this.blurH.draw(encoder, { view: this._tempView, bindKey: 'h' });
                this.blurV.setBindings({ tMap: this._tempView, tSource: this._tempView, mapSampler: sampler }, 'v');
                this.blurV.draw(encoder, { view: views[0], bindKey: 'v' });
            }
        }

        this.composite.setBindings({ tMap: sourceView, tBloom: views[0], mapSampler: sampler }, 'c');
        this.composite.draw(encoder, { view: destView, bindKey: 'c' });
    }

    _colorControl(gui, target, key, label) {
        const view = target.uniforms.views[key];
        const proxy = { [label]: { r: view[0], g: view[1], b: view[2] } };
        gui.add(proxy, label, { color: { type: 'float' } }).on('change', (ev) => {
            target.uniforms.set({ [key]: [ev.value.r, ev.value.g, ev.value.b] });
        });
    }

    addGUI(gui) {
        const folder = gui.folder('bloom', { expanded: false });
        folder.add(this, 'enabled');

        const proxy = { mode: this.mode, mask: 'none' };
        folder.add(proxy, 'mode', { options: Object.fromEntries(BLOOM_MODES.map((m) => [m, m])) }).on('change', (ev) => {
            this.mode = ev.value;
        });

        folder.uniform(this.composite, 'intensity', { min: 0, max: 3, step: 0.01 });
        folder.uniform(this.prefilter, 'threshold', { min: 0, max: 4, step: 0.01 });
        folder.uniform(this.prefilter, 'knee', { min: 0, max: 1, step: 0.01 });
        folder.uniform(this.up, 'radius', { min: 0.25, max: 2.5, step: 0.01 });
        folder.uniform(this.prefilter, 'karis', { min: 0, max: 1, step: 0.01, label: 'firefly-clamp' });
        this._colorControl(folder, this.composite, 'tint', 'tint');

        const mask = folder.folder('selective', { expanded: false });
        mask.add(proxy, 'mask', { options: { none: 'none', 'color-key': 'color-key' } }).on('change', (ev) => {
            this.prefilter.uniforms.set({ maskMode: ev.value === 'color-key' ? 1 : 0 });
        });
        this._colorControl(mask, this.prefilter, 'keyColor', 'key-color');
        mask.uniform(this.prefilter, 'tolerance', { min: 0.01, max: 1, step: 0.01 });

        return folder;
    }

    dispose() {
        this._disposeChain();
        [this.prefilter, this.down, this.up, this.kawaseDown, this.kawaseUp, this.blurH, this.blurV, this.composite].forEach((p) => p.dispose());
    }
}
