import { RenderTarget } from '@core/RenderTarget.js';
import { Mat4 } from '@math';
import { FullscreenPass } from '../FullscreenPass.js';
import cocShader from './dof_coc.wgsl?raw';
import bokehShader from './dof_bokeh.wgsl?raw';
import compositeShader from './dof_composite.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

const QUALITY = {
    low: { taps: 16 },
    medium: { taps: 24 },
    high: { taps: 32 },
    ultra: { taps: 48 },
};

/**
 * Depth of field: signed pixel CoC from depth → half-res golden-spiral bokeh
 * gather with foreground/background separation → full-res composite. Runs in
 * linear HDR, before bloom/tonemap.
 */
export class DoFEffect {
    constructor(gpu, { format = 'rgba16float', focusDistance = 10, focusRange = 6, bokehRadius = 8 } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.format = format;

        this._size = { width: 0, height: 0 };
        this._invProj = new Mat4();

        this.cocPass = new FullscreenPass(gpu, { label: 'dof-coc', code: cocShader, targets: [{ format: 'rgba16float' }] });
        this.cocPass.uniforms.set({ focusDistance, focusRange, bokehRadius });

        this.bokehPass = new FullscreenPass(gpu, { label: 'dof-bokeh', code: bokehShader, targets: [{ format: 'rgba16float' }] });
        this.bokehPass.uniforms.set({ bokehRadius, taps: QUALITY.high.taps });

        this.compositePass = new FullscreenPass(gpu, { label: 'dof-composite', code: compositeShader, targets: [{ format }] });
        this.compositePass.uniforms.set({ focusDistance, focusRange, bokehRadius });

        // gui.uniform surface — focus controls live on the coc pass
        this.uniforms = this.cocPass.uniforms;
        this.uniformBuffer = this.cocPass.uniformBuffer;
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (q) this.bokehPass.uniforms.set({ taps: q.taps });
    }

    resize() {
        this._size = { width: 0, height: 0 };
    }

    // keep the three passes' shared params in sync
    _sync(key, value) {
        this.cocPass.uniforms.set({ [key]: value });
        this.compositePass.uniforms.set({ [key]: value });
        if (key === 'bokehRadius') this.bokehPass.uniforms.set({ bokehRadius: value });
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height) return;
        this._half?.destroy?.();
        this._bokeh?.destroy?.();
        this._size = { width: size.width, height: size.height };
        const w = Math.max(2, size.width >> 1);
        const h = Math.max(2, size.height >> 1);
        this._half = new RenderTarget(this.gpu, { label: 'dof-half', width: w, height: h, format: 'rgba16float', usage: USAGE });
        this._bokeh = new RenderTarget(this.gpu, { label: 'dof-bokeh', width: w, height: h, format: 'rgba16float', usage: USAGE });
        this._halfView = this._half.createView(0);
        this._bokehView = this._bokeh.createView(0);
    }

    render(encoder, { sourceView, destView, depthView, sampler, size, camera }) {
        this._ensureTargets(size);
        this._invProj.copy(camera.projectionMatrix).invert();

        this.cocPass.uniforms.set({ inverseProjectionMatrix: this._invProj });
        this.cocPass.setBindings({ tMap: sourceView, tDepth: depthView, mapSampler: sampler }, 'coc');
        this.cocPass.draw(encoder, { view: this._halfView, bindKey: 'coc' });

        this.bokehPass.setBindings({ tMap: this._halfView, mapSampler: sampler }, 'bokeh');
        this.bokehPass.draw(encoder, { view: this._bokehView, bindKey: 'bokeh' });

        this.compositePass.uniforms.set({ inverseProjectionMatrix: this._invProj });
        this.compositePass.setBindings({ tMap: sourceView, tBokeh: this._bokehView, tDepth: depthView, mapSampler: sampler }, 'comp');
        this.compositePass.draw(encoder, { view: destView, bindKey: 'comp' });
    }

    addGUI(gui) {
        const folder = gui.folder('dof', { expanded: false });
        folder.add(this, 'enabled');

        const proxy = {
            focusDistance: this.cocPass.uniforms.views.focusDistance[0],
            focusRange: this.cocPass.uniforms.views.focusRange[0],
            bokehRadius: this.cocPass.uniforms.views.bokehRadius[0],
        };
        folder.add(proxy, 'focusDistance', { min: 0.5, max: 40, step: 0.1, label: 'focus-distance' }).on('change', (ev) => this._sync('focusDistance', ev.value));
        folder.add(proxy, 'focusRange', { min: 0.5, max: 20, step: 0.1, label: 'focus-range' }).on('change', (ev) => this._sync('focusRange', ev.value));
        folder.add(proxy, 'bokehRadius', { min: 1, max: 16, step: 0.5, label: 'bokeh-radius' }).on('change', (ev) => this._sync('bokehRadius', ev.value));
        folder.uniform(this.bokehPass, 'taps', { min: 8, max: 64, step: 1 });

        return folder;
    }

    dispose() {
        this._half?.destroy?.();
        this._bokeh?.destroy?.();
        [this.cocPass, this.bokehPass, this.compositePass].forEach((p) => p.dispose());
    }
}
