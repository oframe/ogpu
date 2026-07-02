import { FullscreenPass } from '../FullscreenPass.js';
import finalShader from './final.wgsl?raw';

export const TONEMAP = { none: 0, aces: 1, agx: 2, neutral: 3, reinhard: 4, uncharted2: 5 };

/**
 * The HDR→LDR boundary: tonemapping + color grading + vignette, ending in an
 * sRGB encode. Sits after the HDR effects in the chain; AA effects that want
 * perceptual input (FXAA/SMAA) run after it. Output is LDR values in the
 * (still rgba16float) ping-pong — the final blit passes them through 1:1.
 */
export class FinalPassEffect {
    constructor(gpu, { format = 'rgba16float', toneMapping = 'aces' } = {}) {
        this.gpu = gpu;
        this.enabled = true;

        this.pass = new FullscreenPass(gpu, {
            label: 'post-final',
            code: finalShader,
            targets: [{ format }],
        });

        // gui.uniform-compatible surface
        this.uniforms = this.pass.uniforms;
        this.uniformBuffer = this.pass.uniformBuffer;

        this.uniforms.set({
            exposure: 1,
            contrast: 1,
            saturation: 1,
            temperature: 0,
            tint: 0,
            toneMapping: TONEMAP[toneMapping] ?? TONEMAP.aces,
            lift: [0, 0, 0],
            gamma: [1, 1, 1],
            gain: [1, 1, 1],
            vignetteColor: [0, 0, 0],
            vignetteAmount: 0.5,
            vignetteRadius: 1.1,
            vignetteSmoothness: 0.6,
            vignetteRoundness: 1,
        });
    }

    setQuality() {} // always full quality — a fullscreen pass has no tiers

    resize() {} // bindings re-memoize off the fresh views handed to render()

    render(encoder, { sourceView, destView, sampler, size }) {
        this.uniforms.set({ resolution: [size.width, size.height] });
        this.pass.setBindings({ tMap: sourceView, mapSampler: sampler });
        this.pass.draw(encoder, { view: destView });
    }

    _colorControl(gui, key, label) {
        const view = this.uniforms.views[key];
        const proxy = { [label]: { r: view[0], g: view[1], b: view[2] } };
        gui.add(proxy, label, { color: { type: 'float' } }).on('change', (ev) => {
            this.uniforms.set({ [key]: [ev.value.r, ev.value.g, ev.value.b] });
        });
    }

    addGUI(gui) {
        const folder = gui.folder('final', { expanded: false });
        folder.add(this, 'enabled');

        const proxy = { tonemap: Object.keys(TONEMAP).find((k) => TONEMAP[k] === this.uniforms.views.toneMapping[0]) };
        folder.add(proxy, 'tonemap', { options: Object.fromEntries(Object.keys(TONEMAP).map((k) => [k, k])) }).on('change', (ev) => {
            this.uniforms.set({ toneMapping: TONEMAP[ev.value] });
        });

        folder.uniform(this, 'exposure', { min: 0, max: 4, step: 0.01 });
        folder.uniform(this, 'contrast', { min: 0, max: 2, step: 0.01 });
        folder.uniform(this, 'saturation', { min: 0, max: 2, step: 0.01 });
        folder.uniform(this, 'temperature', { min: -1, max: 1, step: 0.01 });
        folder.uniform(this, 'tint', { min: -1, max: 1, step: 0.01 });

        const grade = folder.folder('lift-gamma-gain', { expanded: false });
        this._colorControl(grade, 'lift', 'lift');
        this._colorControl(grade, 'gamma', 'gamma');
        this._colorControl(grade, 'gain', 'gain');

        const vig = folder.folder('vignette', { expanded: false });
        vig.uniform(this, 'vignetteAmount', { min: 0, max: 1, step: 0.01, label: 'amount' });
        vig.uniform(this, 'vignetteRadius', { min: 0, max: 2, step: 0.01, label: 'radius' });
        vig.uniform(this, 'vignetteSmoothness', { min: 0, max: 1.5, step: 0.01, label: 'smoothness' });
        vig.uniform(this, 'vignetteRoundness', { min: 0, max: 1, step: 0.01, label: 'roundness' });
        this._colorControl(vig, 'vignetteColor', 'color');

        return folder;
    }

    dispose() {
        this.pass.dispose();
    }
}
