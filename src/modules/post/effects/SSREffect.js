import { RenderTarget } from '@core/RenderTarget.js';
import { Mat4 } from '@math';
import { FullscreenPass } from '../FullscreenPass.js';
import traceShader from './ssr_trace.wgsl?raw';
import compositeShader from './ssr_composite.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

const QUALITY = {
    low: { steps: 0 }, // 0 = effect off at this tier
    medium: { steps: 16 },
    high: { steps: 32 },
    ultra: { steps: 64 },
};

/**
 * Screen-space reflections: half-res view-space raymarch + binary refine,
 * composited by schlick fresnel. Only reflects what's on screen — edges and
 * long rays fade out by confidence. Linear HDR, sits between AO and DoF.
 */
export class SSREffect {
    constructor(gpu, { format = 'rgba16float', maxDistance = 18, thickness = 0.4, intensity = 0.8 } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.format = format;

        this._size = { width: 0, height: 0 };
        this._invProj = new Mat4();
        this._tierDisabled = false;

        this.tracePass = new FullscreenPass(gpu, { label: 'ssr-trace', code: traceShader, targets: [{ format: 'rgba16float' }] });
        this.tracePass.uniforms.set({ maxDistance, thickness, steps: QUALITY.high.steps });

        this.compositePass = new FullscreenPass(gpu, { label: 'ssr-composite', code: compositeShader, targets: [{ format }] });
        this.compositePass.uniforms.set({ intensity, fresnelPower: 5, f0: 0.06 });

        this.uniforms = this.tracePass.uniforms;
        this.uniformBuffer = this.tracePass.uniformBuffer;
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this._tierDisabled = q.steps === 0;
        if (q.steps > 0) this.tracePass.uniforms.set({ steps: q.steps });
    }

    resize() {
        this._size = { width: 0, height: 0 };
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height) return;
        this._trace?.destroy?.();
        this._size = { width: size.width, height: size.height };
        this._trace = new RenderTarget(this.gpu, {
            label: 'ssr-trace-buffer',
            width: Math.max(2, size.width >> 1),
            height: Math.max(2, size.height >> 1),
            format: 'rgba16float',
            usage: USAGE,
        });
        this._traceView = this._trace.createView(0);
    }

    render(encoder, { sourceView, destView, depthView, normalView, sampler, size, camera, frameIndex }) {
        if (this._tierDisabled) return false;

        this._ensureTargets(size);
        this._invProj.copy(camera.projectionMatrix).invert();

        this.tracePass.uniforms.set({
            resolution: [this._trace.width, this._trace.height],
            frameIndex: frameIndex % 4096,
            projectionMatrix: camera.projectionMatrix,
            inverseProjectionMatrix: this._invProj,
            viewMatrix: camera.viewMatrix,
        });
        this.tracePass.setBindings({ tMap: sourceView, tNormal: normalView, tDepth: depthView, mapSampler: sampler }, 'trace');
        this.tracePass.draw(encoder, { view: this._traceView, bindKey: 'trace' });

        this.compositePass.uniforms.set({ inverseProjectionMatrix: this._invProj, viewMatrix: camera.viewMatrix });
        this.compositePass.setBindings({ tMap: sourceView, tReflection: this._traceView, tNormal: normalView, tDepth: depthView, mapSampler: sampler }, 'comp');
        this.compositePass.draw(encoder, { view: destView, bindKey: 'comp' });
    }

    addGUI(gui) {
        const folder = gui.folder('ssr', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this.compositePass, 'intensity', { min: 0, max: 2, step: 0.01 });
        folder.uniform(this, 'maxDistance', { min: 1, max: 60, step: 0.5, label: 'max-distance' });
        folder.uniform(this, 'thickness', { min: 0.05, max: 2, step: 0.05 });
        folder.uniform(this, 'steps', { min: 8, max: 64, step: 1 });
        folder.uniform(this.compositePass, 'f0', { min: 0, max: 0.5, step: 0.005 });
        folder.uniform(this.compositePass, 'fresnelPower', { min: 1, max: 8, step: 0.1, label: 'fresnel-power' });
        return folder;
    }

    dispose() {
        this._trace?.destroy?.();
        [this.tracePass, this.compositePass].forEach((p) => p.dispose());
    }
}
