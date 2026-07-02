import { RenderTarget } from '@core/RenderTarget.js';
import { Mat4 } from '@math';
import { FullscreenPass } from '../FullscreenPass.js';
import taaShader from './taa.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

const QUALITY = {
    low: { enabled: false },
    medium: { blend: 0.85 },
    high: { blend: 0.9 },
    ultra: { blend: 0.93 },
};

/**
 * Temporal antialiasing. `needsJitter` makes the composer inject per-frame
 * Halton sub-pixel jitter into the camera projection; this pass reprojects
 * last frame's resolve through depth (camera-motion velocity), clamps it to
 * the current 3x3 neighborhood and blends. Sits after AO/SSR (denoises their
 * IGN patterns) and before DoF/bloom. Per-object motion vectors are a later
 * extension — fast-moving objects fall back to the clamp.
 */
export class TAAEffect {
    constructor(gpu, { format = 'rgba16float', blend = 0.9 } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.needsJitter = true;
        this.format = format;

        this._size = { width: 0, height: 0 };
        this._tierDisabled = false;
        this._historyValid = false;

        this._viewProj = new Mat4();
        this._prevViewProj = new Mat4();
        this._invViewProj = new Mat4();
        this._unjitteredProj = new Mat4();

        this.pass = new FullscreenPass(gpu, { label: 'post-taa', code: taaShader, targets: [{ format }] });
        this.pass.uniforms.set({ blend });

        this.uniforms = this.pass.uniforms;
        this.uniformBuffer = this.pass.uniformBuffer;
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this._tierDisabled = q.enabled === false;
        if (q.blend) this.pass.uniforms.set({ blend: q.blend });
    }

    resize() {
        this._size = { width: 0, height: 0 };
        this._historyValid = false;
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height) return;
        this._history?.destroy?.();
        this._size = { width: size.width, height: size.height };
        this._history = new RenderTarget(this.gpu, { label: 'taa-history', width: size.width, height: size.height, format: this.format, usage: USAGE });
        this._historyView = this._history.createView(0);
        this._historyValid = false;
    }

    render(encoder, { sourceView, destView, destTarget, depthView, sampler, size, camera, composer }) {
        if (this._tierDisabled) return false;

        this._ensureTargets(size);

        // unjittered view-projection — jittered velocity would shimmer
        const [jx, jy] = composer.jitter;
        this._unjitteredProj.copy(camera.projectionMatrix);
        this._unjitteredProj[8] -= jx;
        this._unjitteredProj[9] -= jy;
        this._viewProj.copy(this._unjitteredProj).multiply(camera.viewMatrix);
        this._invViewProj.copy(this._viewProj).invert();

        this.pass.uniforms.set({
            resolution: [size.width, size.height],
            firstFrame: this._historyValid ? 0 : 1,
            prevViewProjectionMatrix: this._historyValid ? this._prevViewProj : this._viewProj,
            inverseViewProjectionMatrix: this._invViewProj,
        });

        this.pass.setBindings({ tMap: sourceView, tHistory: this._historyView, tDepth: depthView, mapSampler: sampler }, 'taa');
        this.pass.draw(encoder, { view: destView, bindKey: 'taa' });

        // stash this frame's resolve as next frame's history
        encoder.copyTextureToTexture({ texture: destTarget.textures[0].texture }, { texture: this._history.textures[0].texture }, [size.width, size.height, 1]);

        this._prevViewProj.copy(this._viewProj);
        this._historyValid = true;
    }

    addGUI(gui) {
        const folder = gui.folder('taa', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this, 'blend', { min: 0.5, max: 0.98, step: 0.01, label: 'history-blend' });
        return folder;
    }

    dispose() {
        this._history?.destroy?.();
        this.pass.dispose();
    }
}
