import { RenderTarget } from '@core/RenderTarget.js';
import { Mat4 } from '@math';
import { FullscreenPass } from '../FullscreenPass.js';
import blurShader from './ao_blur.wgsl?raw';
import applyShader from './ao_apply.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

/**
 * Shared AO plumbing: estimation pass (subclass supplies the shader and
 * per-frame uniforms) → depth-aware separable blur → multiply-apply. The AO
 * buffer runs at `resScale` of the frame (bilateral-ish blur + linear
 * upsample hide the difference).
 */
export class AOBase {
    constructor(gpu, { format = 'rgba16float', label = 'ao', code } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.label = label;
        this.resScale = 0.5;

        this._size = { width: 0, height: 0 };
        this._scale = 0;

        this.aoPass = new FullscreenPass(gpu, { label: `${label}-estimate`, code, targets: [{ format: 'rgba8unorm' }] });
        this.blurH = new FullscreenPass(gpu, { label: `${label}-blur-h`, code: blurShader, targets: [{ format: 'rgba8unorm' }] });
        this.blurH.uniforms.set({ direction: [1, 0], depthSharpness: 400 });
        this.blurV = new FullscreenPass(gpu, { label: `${label}-blur-v`, code: blurShader, targets: [{ format: 'rgba8unorm' }] });
        this.blurV.uniforms.set({ direction: [0, 1], depthSharpness: 400 });
        this.apply = new FullscreenPass(gpu, { label: `${label}-apply`, code: applyShader, targets: [{ format }] });
        this.apply.uniforms.set({ intensity: 1 });

        this._invProj = new Mat4();

        // gui.uniform-compatible surface targets the estimation pass
        this.uniforms = this.aoPass.uniforms;
        this.uniformBuffer = this.aoPass.uniformBuffer;
    }

    resize() {
        this._size = { width: 0, height: 0 };
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height && this._scale === this.resScale) return;
        this._ao?.destroy?.();
        this._temp?.destroy?.();
        this._size = { width: size.width, height: size.height };
        this._scale = this.resScale;

        const w = Math.max(2, Math.round(size.width * this.resScale));
        const h = Math.max(2, Math.round(size.height * this.resScale));
        this._ao = new RenderTarget(this.gpu, { label: `${this.label}-buffer`, width: w, height: h, format: 'rgba8unorm', usage: USAGE });
        this._temp = new RenderTarget(this.gpu, { label: `${this.label}-blur-temp`, width: w, height: h, format: 'rgba8unorm', usage: USAGE });
        this._aoView = this._ao.createView(0);
        this._tempView = this._temp.createView(0);
    }

    // subclass hook: write per-frame uniforms into this.aoPass.uniforms
    updateUniforms() {}

    render(encoder, ctx) {
        const { sourceView, destView, depthView, normalView, sampler } = ctx;
        this._ensureTargets(ctx.size);

        this._invProj.copy(ctx.camera.projectionMatrix).invert();
        this.updateUniforms(ctx, { aoWidth: this._ao.width, aoHeight: this._ao.height });

        this.aoPass.setBindings({ tNormal: normalView, tDepth: depthView, mapSampler: sampler }, 'ao');
        this.aoPass.draw(encoder, { view: this._aoView, bindKey: 'ao' });

        this.blurH.setBindings({ tMap: this._aoView, tDepth: depthView, mapSampler: sampler }, 'h');
        this.blurH.draw(encoder, { view: this._tempView, bindKey: 'h' });
        this.blurV.setBindings({ tMap: this._tempView, tDepth: depthView, mapSampler: sampler }, 'v');
        this.blurV.draw(encoder, { view: this._aoView, bindKey: 'v' });

        this.apply.setBindings({ tMap: sourceView, tAo: this._aoView, mapSampler: sampler }, 'apply');
        this.apply.draw(encoder, { view: destView, bindKey: 'apply' });
    }

    dispose() {
        this._ao?.destroy?.();
        this._temp?.destroy?.();
        [this.aoPass, this.blurH, this.blurV, this.apply].forEach((p) => p.dispose());
    }
}
