import { Texture } from '@core/Texture.js';
import { parseKTXHeader, formatBlockInfo } from '@utils/ktxutils';

// Pick a transcode target the device can actually sample. Basis Universal
// (`.ktx2` with vkFormat 0) is GPU-agnostic until transcoded; order by
// preference and fall back to uncompressed RGBA32 so it always loads.
function pickTranscodeTarget(device) {
    const tt = window.ktx.TranscodeTarget;
    const f = device.features;
    if (f.has('texture-compression-astc')) return { target: tt.ASTC_4x4_RGBA, format: 'astc-4x4-unorm' };
    if (f.has('texture-compression-bc')) return { target: tt.BC7_RGBA, format: 'bc7-rgba-unorm' };
    if (f.has('texture-compression-etc2')) return { target: tt.ETC2_RGBA, format: 'etc2-rgba8unorm' };
    return { target: tt.RGBA32, format: 'rgba8unorm' };
}

/**
 * Loads a `.ktx` / `.ktx2` file into a sampleable 2D texture, including
 * Basis-Universal supercompressed files (transcoded to a format the device
 * supports). Thin loader on top of {@link Texture}: it allocates the real
 * GPUTexture once the header is parsed, then uploads each mip with the
 * block-aware row pitch compressed formats need.
 *
 * Async — `await ktxTexture.ready` before sampling. Bind via `.createView()`.
 * Requires `window.ktx` (the Khronos KTX reader), ready after `renderer.ready`.
 *
 * ```js
 * const tex = new KTXTexture(gpu, { src: './assets/foo.ktx2' });
 * await tex.ready;
 * const view = tex.createView();
 * ```
 */
export class KTXTexture extends Texture {
    constructor(gpu, { src, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label = 'KTXTexture' } = {}) {
        // Placeholder 2x2 — replaced by #load once the file's dimensions/format
        // are known. Texture.update() destroys + recreates on the size change.
        super(gpu, { width: 2, height: 2, usage, label });
        this.src = src;
        this.ready = this.#load(src).then(() => this);
    }

    async #load(url) {
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const header = parseKTXHeader(buf);
        const ktx = new window.ktx.ktxTexture(buf);

        let format = header.format;
        if (ktx.needsTranscoding) {
            const pick = pickTranscodeTarget(this.gpu.device);
            const code = ktx.transcodeBasis(pick.target, 0);
            if (code !== window.ktx.ErrorCode.SUCCESS) {
                throw new Error(`KTXTexture: transcode failed (${code}) for ${url}`);
            }
            format = pick.format;
        }

        const block = format && formatBlockInfo(format);
        if (!block) throw new Error(`KTXTexture: unsupported format "${format}" for ${url}`);

        // Allocate the real texture (no data — we upload mips ourselves below so
        // compressed row pitch is handled, which Texture.update doesn't do).
        this.update({
            width: header.width,
            height: header.height,
            format,
            usage: this.usage,
            mipLevelCount: header.levels,
        });

        for (let level = 0; level < header.levels; level++) {
            const data = ktx.getImage(level, 0, 0);
            const w = Math.max(1, header.width >> level);
            const h = Math.max(1, header.height >> level);
            this.gpu.device.queue.writeTexture(
                { texture: this.texture, mipLevel: level },
                data,
                {
                    bytesPerRow: Math.ceil(w / block.blockW) * block.blockBytes,
                    rowsPerImage: Math.ceil(h / block.blockH),
                },
                { width: w, height: h, depthOrArrayLayers: 1 }
            );
        }

        ktx.delete?.();
    }
}
