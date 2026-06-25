import { Texture } from '@core/Texture.js';

/**
 * Assembles a cubemap texture from 6 face sources.
 *
 * `src` is a list of 6 entries in WebGPU/D3D cube order:
 *   +X, -X, +Y, -Y, +Z, -Z
 * Each entry is either a URL string, or a decoded source webgpu-utils accepts
 * (ImageBitmap, HTMLImageElement/-Canvas, OffscreenCanvas, VideoFrame).
 *
 * Thin wrapper over webgpu-utils' image-to-texture helpers — they fetch,
 * decode, upload, and optionally build mips. Async: `await cubemap.ready`
 * before sampling. Bind via `cubemap.view` (a `dimension: 'cube'` view),
 * sampled in WGSL as `texture_cube<f32>`.
 */
export class CubeMap {
    constructor(gpu, { src = [], mips = false, flipY = false, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, label = 'CubeMap' } = {}) {
        if (src.length !== 6) {
            throw new Error(`CubeMap: expected 6 face sources, got ${src.length}`);
        }

        this._texture = new Texture(gpu, { src, mips, flipY, usage, label, isCubeMap: true });

        this.ready = this._texture.ready.then(() => this);
    }

    get texture() {
        return this._texture.texture;
    }

    get view() {
        return this._texture.texture ? this._texture.createView() : undefined;
    }

    destroy() {
        this._texture.destroy();
    }
}
