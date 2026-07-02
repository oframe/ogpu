import { FullscreenPass } from '../FullscreenPass.js';
import fxaaShader from './fxaa.wgsl?raw';

// Subpixel aliasing removal strength per quality tier (FXAA 3.11 subpix knob).
const SUBPIX_TIER = { low: 0.5, medium: 0.75, high: 0.75, ultra: 1.0 };

/**
 * FXAA 3.11 (PC quality preset). A perceptual-space antialias pass — runs after
 * the tonemap/sRGB-encode boundary (FinalPassEffect) on LDR input. Reads the
 * green-weighted luma to find edges, then blends along them.
 */
export class FXAAEffect {
    constructor(gpu, { format = 'rgba16float' } = {}) {
        this.gpu = gpu;
        this.enabled = true;

        this.pass = new FullscreenPass(gpu, {
            label: 'post-fxaa',
            code: fxaaShader,
            targets: [{ format }],
        });

        // gui.uniform-compatible surface
        this.uniforms = this.pass.uniforms;
        this.uniformBuffer = this.pass.uniformBuffer;

        this.uniforms.set({
            subpix: 0.75,
            edgeThreshold: 0.166,
            edgeThresholdMin: 0.0833,
        });
    }

    setQuality(tier) {
        const subpix = SUBPIX_TIER[tier];
        if (subpix !== undefined) this.uniforms.set({ subpix });
    }

    resize() {} // bindings re-memoize off the fresh views handed to render()

    render(encoder, { sourceView, destView, sampler, size }) {
        this.uniforms.set({ resolution: [size.width, size.height] });
        this.pass.setBindings({ tMap: sourceView, mapSampler: sampler });
        this.pass.draw(encoder, { view: destView });
    }

    addGUI(gui) {
        const folder = gui.folder('fxaa', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this, 'subpix', { min: 0, max: 1, step: 0.01 });
        folder.uniform(this, 'edgeThreshold', { min: 0, max: 0.5, step: 0.001 });
        folder.uniform(this, 'edgeThresholdMin', { min: 0, max: 0.2, step: 0.001 });
        return folder;
    }

    dispose() {
        this.pass.dispose();
    }
}
