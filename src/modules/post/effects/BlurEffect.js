import { RenderTarget } from '@core/RenderTarget.js';
import { FullscreenPass } from '../FullscreenPass.js';
import gaussianShader from './blur_gaussian.wgsl?raw';
import kawaseDownShader from './blur_kawase_down.wgsl?raw';
import kawaseUpShader from './blur_kawase_up.wgsl?raw';
import mixShader from './blur_mix.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

const QUALITY = {
    low: { levels: 2 },
    medium: { levels: 3 },
    high: { levels: 3 },
    ultra: { levels: 4 },
};

export const BLUR_MODES = ['gaussian', 'kawase'];

/**
 * Standalone fullscreen blur (artistic — frosted transitions, focus pulls):
 * `gaussian` = separable 17-tap at full res; `kawase` = dual-filter chain,
 * far cheaper for large radii. `amount` mixes blurred over sharp.
 */
export class BlurEffect {
    constructor(gpu, { format = 'rgba16float', mode = 'gaussian', radius = 8, amount = 1 } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.format = format;
        this.mode = mode;
        this.levels = QUALITY.high.levels;

        this._size = { width: 0, height: 0 };
        this._chain = [];
        this._chainViews = [];

        const targets = [{ format }];

        this.blurH = new FullscreenPass(gpu, { label: 'blur-h', code: gaussianShader, targets });
        this.blurH.uniforms.set({ direction: [1, 0], radius, mixAmount: 1 });
        this.blurV = new FullscreenPass(gpu, { label: 'blur-v', code: gaussianShader, targets });
        this.blurV.uniforms.set({ direction: [0, 1], radius, mixAmount: 1 });

        this.kawaseDown = new FullscreenPass(gpu, { label: 'blur-kawase-down', code: kawaseDownShader, targets });
        this.kawaseDown.uniforms.set({ offset: 1 });
        this.kawaseUp = new FullscreenPass(gpu, { label: 'blur-kawase-up', code: kawaseUpShader, targets });
        this.kawaseUp.uniforms.set({ offset: 1 });

        this.mix = new FullscreenPass(gpu, { label: 'blur-mix', code: mixShader, targets });
        this.mix.uniforms.set({ amount });
    }

    get radius() {
        return this.blurH.uniforms.views.radius[0];
    }

    set radius(v) {
        this.blurH.uniforms.set({ radius: v });
        this.blurV.uniforms.set({ radius: v });
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (q) this.levels = q.levels;
    }

    resize() {
        this._size = { width: 0, height: 0 };
    }

    _disposeTargets() {
        this._chain.forEach((t) => t.destroy());
        this._tempA?.destroy?.();
        this._tempB?.destroy?.();
        this._chain = [];
        this._chainViews = [];
        this._tempA = null;
        this._tempB = null;
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height && this._chain.length === this.levels) return;
        this._disposeTargets();
        this._size = { width: size.width, height: size.height };

        this._tempA = new RenderTarget(this.gpu, { label: 'blur-temp-a', width: size.width, height: size.height, format: this.format, usage: USAGE });
        this._tempB = new RenderTarget(this.gpu, { label: 'blur-temp-b', width: size.width, height: size.height, format: this.format, usage: USAGE });
        this._tempAView = this._tempA.createView(0);
        this._tempBView = this._tempB.createView(0);

        let w = size.width;
        let h = size.height;
        for (let i = 0; i < this.levels; i++) {
            w = Math.max(4, w >> 1);
            h = Math.max(4, h >> 1);
            this._chain.push(new RenderTarget(this.gpu, { label: `blur-level-${i}`, width: w, height: h, format: this.format, usage: USAGE }));
        }
        this._chainViews = this._chain.map((t) => t.createView(0));
    }

    render(encoder, { sourceView, destView, sampler, size }) {
        this._ensureTargets(size);

        let blurredView;
        if (this.mode === 'kawase') {
            const views = this._chainViews;
            const last = views.length - 1;
            this.kawaseDown.setBindings({ tMap: sourceView, mapSampler: sampler }, 'd0');
            this.kawaseDown.draw(encoder, { view: views[0], bindKey: 'd0' });
            for (let i = 1; i <= last; i++) {
                this.kawaseDown.setBindings({ tMap: views[i - 1], mapSampler: sampler }, `d${i}`);
                this.kawaseDown.draw(encoder, { view: views[i], bindKey: `d${i}` });
            }
            for (let i = last - 1; i >= 0; i--) {
                this.kawaseUp.setBindings({ tMap: views[i + 1], mapSampler: sampler }, `u${i}`);
                this.kawaseUp.draw(encoder, { view: views[i], bindKey: `u${i}` });
            }
            blurredView = views[0];
        } else {
            this.blurH.setBindings({ tMap: sourceView, tSource: sourceView, mapSampler: sampler }, 'h');
            this.blurH.draw(encoder, { view: this._tempAView, bindKey: 'h' });
            this.blurV.setBindings({ tMap: this._tempAView, tSource: this._tempAView, mapSampler: sampler }, 'v');
            this.blurV.draw(encoder, { view: this._tempBView, bindKey: 'v' });
            blurredView = this._tempBView;
        }

        this.mix.setBindings({ tMap: blurredView, tSource: sourceView, mapSampler: sampler }, 'm');
        this.mix.draw(encoder, { view: destView, bindKey: 'm' });
    }

    addGUI(gui) {
        const folder = gui.folder('blur', { expanded: false });
        folder.add(this, 'enabled');

        const proxy = { mode: this.mode };
        folder.add(proxy, 'mode', { options: Object.fromEntries(BLUR_MODES.map((m) => [m, m])) }).on('change', (ev) => {
            this.mode = ev.value;
        });

        folder.add(this, 'radius', { min: 0, max: 32, step: 0.5 });
        folder.uniform(this.mix, 'amount', { min: 0, max: 1, step: 0.01 });

        const kawase = { offset: this.kawaseDown.uniforms.views.offset[0] };
        folder.add(kawase, 'offset', { min: 0.5, max: 4, step: 0.1, label: 'kawase-offset' }).on('change', (ev) => {
            this.kawaseDown.uniforms.set({ offset: ev.value });
            this.kawaseUp.uniforms.set({ offset: ev.value });
        });

        return folder;
    }

    dispose() {
        this._disposeTargets();
        [this.blurH, this.blurV, this.kawaseDown, this.kawaseUp, this.mix].forEach((p) => p.dispose());
    }
}
