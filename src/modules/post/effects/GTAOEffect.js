import { AOBase } from './AOBase.js';
import gtaoShader from './gtao.wgsl?raw';

const QUALITY = {
    low: { sliceCount: 2, stepsPerSlice: 2, resScale: 0.5 },
    medium: { sliceCount: 2, stepsPerSlice: 3, resScale: 0.5 },
    high: { sliceCount: 3, stepsPerSlice: 4, resScale: 0.5 },
    ultra: { sliceCount: 4, stepsPerSlice: 6, resScale: 1 },
};

/**
 * GTAO — the quality AO tier. Horizon-based visibility with the
 * cosine-weighted arc integral; IGN-animated for temporal convergence.
 */
export class GTAOEffect extends AOBase {
    constructor(gpu, { format = 'rgba16float', radius = 1.0, power = 1.2, bias = 0.08 } = {}) {
        super(gpu, { format, label: 'gtao', code: gtaoShader });
        this.aoPass.uniforms.set({ radius, power, bias, sliceCount: 3, stepsPerSlice: 4 });
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this.aoPass.uniforms.set({ sliceCount: q.sliceCount, stepsPerSlice: q.stepsPerSlice });
        this.resScale = q.resScale;
    }

    updateUniforms({ camera, frameIndex }, { aoWidth, aoHeight }) {
        // world-radius → screen-pixel scale at z=1: half the target height
        // times the projection's vertical focal term
        const projScale = 0.5 * aoHeight * camera.projectionMatrix[5];
        this.aoPass.uniforms.set({
            resolution: [aoWidth, aoHeight],
            projScale,
            frameIndex: frameIndex % 4096,
            inverseProjectionMatrix: this._invProj,
            viewMatrix: camera.viewMatrix,
        });
    }

    addGUI(gui) {
        const folder = gui.folder('gtao', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this.apply, 'intensity', { min: 0, max: 1, step: 0.01 });
        folder.uniform(this, 'radius', { min: 0.1, max: 5, step: 0.05 });
        folder.uniform(this, 'power', { min: 0.5, max: 4, step: 0.05 });
        folder.uniform(this, 'bias', { min: 0, max: 0.3, step: 0.005 });
        folder.uniform(this, 'sliceCount', { min: 1, max: 6, step: 1, label: 'slices' });
        folder.uniform(this, 'stepsPerSlice', { min: 1, max: 8, step: 1, label: 'steps' });
        folder.uniform(this.blurH, 'depthSharpness', { min: 0, max: 2000, step: 10 }).on('change', (ev) => {
            this.blurV.uniforms.set({ depthSharpness: ev.value });
        });
        return folder;
    }
}
