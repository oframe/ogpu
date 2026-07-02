import { AOBase } from './AOBase.js';
import ssaoShader from './ssao.wgsl?raw';

const QUALITY = {
    low: { kernelSize: 8, resScale: 0.5 },
    medium: { kernelSize: 12, resScale: 0.5 },
    high: { kernelSize: 16, resScale: 0.5 },
    ultra: { kernelSize: 32, resScale: 1 },
};

function buildKernel() {
    // cosine-ish hemisphere kernel, samples pulled toward the origin
    const kernel = new Float32Array(32 * 4);
    for (let i = 0; i < 32; i++) {
        let x = Math.random() * 2 - 1;
        let y = Math.random() * 2 - 1;
        let z = Math.random();
        const len = Math.hypot(x, y, z) || 1;
        const t = i / 31;
        const scale = (0.1 + 0.9 * t * t) * (0.25 + 0.75 * Math.random());
        kernel[i * 4 + 0] = (x / len) * scale;
        kernel[i * 4 + 1] = (y / len) * scale;
        kernel[i * 4 + 2] = (z / len) * scale;
    }
    return kernel;
}

/**
 * Classic hemisphere-kernel SSAO — the cheap AO tier for mobile-class GPUs.
 */
export class SSAOEffect extends AOBase {
    constructor(gpu, { format = 'rgba16float', radius = 0.8, bias = 0.02, power = 1.2 } = {}) {
        super(gpu, { format, label: 'ssao', code: ssaoShader });
        this.aoPass.uniforms.set({ radius, bias, power, kernelSize: 16, kernel: buildKernel() });
    }

    setQuality(tier) {
        const q = QUALITY[tier];
        if (!q) return;
        this.aoPass.uniforms.set({ kernelSize: q.kernelSize });
        this.resScale = q.resScale;
    }

    updateUniforms({ camera, frameIndex }, { aoWidth, aoHeight }) {
        this.aoPass.uniforms.set({
            resolution: [aoWidth, aoHeight],
            frameIndex: frameIndex % 4096,
            projectionMatrix: camera.projectionMatrix,
            inverseProjectionMatrix: this._invProj,
            viewMatrix: camera.viewMatrix,
        });
    }

    addGUI(gui) {
        const folder = gui.folder('ssao', { expanded: false });
        folder.add(this, 'enabled');
        folder.uniform(this.apply, 'intensity', { min: 0, max: 1, step: 0.01 });
        folder.uniform(this, 'radius', { min: 0.1, max: 4, step: 0.05 });
        folder.uniform(this, 'bias', { min: 0, max: 0.2, step: 0.002 });
        folder.uniform(this, 'power', { min: 0.5, max: 4, step: 0.05 });
        folder.uniform(this, 'kernelSize', { min: 4, max: 32, step: 1, label: 'samples' });
        folder.uniform(this.blurH, 'depthSharpness', { min: 0, max: 2000, step: 10 }).on('change', (ev) => {
            this.blurV.uniforms.set({ depthSharpness: ev.value });
        });
        return folder;
    }
}
