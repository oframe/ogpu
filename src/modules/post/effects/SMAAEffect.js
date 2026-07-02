import { RenderTarget } from '@core/RenderTarget.js';
import { Texture } from '@core/Texture.js';
import { FullscreenPass } from '../FullscreenPass.js';
import edgesShader from './smaa_edges.wgsl?raw';
import weightsShader from './smaa_weights.wgsl?raw';
import blendShader from './smaa_blend.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

const QUALITY = {
    low: { threshold: 0.15, maxSearchSteps: 4 },
    medium: { threshold: 0.1, maxSearchSteps: 8 },
    high: { threshold: 0.1, maxSearchSteps: 16 },
    ultra: { threshold: 0.05, maxSearchSteps: 32 },
};

/**
 * SMAA 1x (Jimenez et al.): edge detect → blending weights (area/search LUTs)
 * → neighborhood blend. Straight-edge quality — diagonal/corner handling
 * omitted. Runs on LDR post-tonemap input, after FinalPass. The LUTs load
 * async from `assetsPath`; until they resolve, render() returns false and the
 * composer passes the frame through untouched.
 */
export class SMAAEffect {
    constructor(gpu, { format = 'rgba16float', assetsPath = './assets/smaa' } = {}) {
        this.gpu = gpu;
        this.enabled = true;
        this.format = format;

        this._size = { width: 0, height: 0 };
        this._ready = false;

        this.edgesPass = new FullscreenPass(gpu, { label: 'smaa-edges', code: edgesShader, targets: [{ format: 'rgba8unorm' }] });
        this.weightsPass = new FullscreenPass(gpu, { label: 'smaa-weights', code: weightsShader, targets: [{ format: 'rgba8unorm' }] });
        this.blendPass = new FullscreenPass(gpu, { label: 'smaa-blend', code: blendShader, targets: [{ format }] });

        this.setQuality('high');

        this.pointSampler = gpu.device.createSampler({
            label: 'smaa-point-sampler',
            minFilter: 'nearest',
            magFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.areaTexture = new Texture(gpu, { label: 'smaa-area', src: `${assetsPath}/smaa-area.png` });
        this.searchTexture = new Texture(gpu, { label: 'smaa-search', src: `${assetsPath}/smaa-search.png` });
        this.ready = Promise.all([this.areaTexture.ready, this.searchTexture.ready]).then(() => {
            this._areaView = this.areaTexture.createView();
            this._searchView = this.searchTexture.createView();
            this._ready = true;
        });
        gpu.renderer?.trackCompile?.(this.ready);
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this.edgesPass.uniforms.set({ threshold: q.threshold });
        this.weightsPass.uniforms.set({ maxSearchSteps: q.maxSearchSteps });
    }

    resize() {
        this._size = { width: 0, height: 0 };
    }

    _ensureTargets(size) {
        if (this._size.width === size.width && this._size.height === size.height) return;
        this._edges?.destroy?.();
        this._weights?.destroy?.();
        this._size = { width: size.width, height: size.height };
        this._edges = new RenderTarget(this.gpu, { label: 'smaa-edges', width: size.width, height: size.height, format: 'rgba8unorm', usage: USAGE });
        this._weights = new RenderTarget(this.gpu, { label: 'smaa-weights', width: size.width, height: size.height, format: 'rgba8unorm', usage: USAGE });
        this._edgesView = this._edges.createView(0);
        this._weightsView = this._weights.createView(0);
    }

    render(encoder, { sourceView, destView, sampler, size }) {
        if (!this._ready) return false; // LUTs still loading — skip, composer passes through

        this._ensureTargets(size);
        const resolution = [size.width, size.height];

        this.edgesPass.uniforms.set({ resolution });
        this.edgesPass.setBindings({ tMap: sourceView, mapSampler: sampler }, 'e');
        this.edgesPass.draw(encoder, { view: this._edgesView, bindKey: 'e', clearValue: { r: 0, g: 0, b: 0, a: 0 } });

        this.weightsPass.uniforms.set({ resolution });
        this.weightsPass.setBindings(
            {
                tEdges: this._edgesView,
                tArea: this._areaView,
                tSearch: this._searchView,
                linearSampler: sampler,
                pointSampler: this.pointSampler,
            },
            'w'
        );
        this.weightsPass.draw(encoder, { view: this._weightsView, bindKey: 'w', clearValue: { r: 0, g: 0, b: 0, a: 0 } });

        this.blendPass.uniforms.set({ resolution });
        this.blendPass.setBindings({ tMap: sourceView, tWeights: this._weightsView, mapSampler: sampler }, 'b');
        this.blendPass.draw(encoder, { view: destView, bindKey: 'b' });
        return true;
    }

    addGUI(gui) {
        const folder = gui.folder('smaa', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this.edgesPass, 'threshold', { min: 0.01, max: 0.3, step: 0.005 });
        folder.uniform(this.weightsPass, 'maxSearchSteps', { min: 2, max: 32, step: 1, label: 'search-steps' });
        return folder;
    }

    dispose() {
        this._edges?.destroy?.();
        this._weights?.destroy?.();
        this.areaTexture.destroy();
        this.searchTexture.destroy();
        [this.edgesPass, this.weightsPass, this.blendPass].forEach((p) => p.dispose());
    }
}
