// Image/source → texture: webgpu-utils' texture helpers, taking the OGPU `gpu`
// object. Sources are anything copyExternalImageToTexture accepts (ImageBitmap,
// canvas, video, ...) or raw texel data (typed array, array, or { data }); all
// sources of one texture share a size, one layer each. Options: mips,
// mipLevelCount, flipY, premultipliedAlpha, colorSpace, format, usage,
// dimension, viewDimension (webgpu-utils' CreateTextureOptions). `mips: true`
// allocates and fills a full chain.
import * as wgu from 'webgpu-utils';

// Texture's `dimension: 'cube'` (isCubeMap) is six layers of a 2d texture;
// webgpu-utils hands `dimension` to createTexture as is. Mips are filled
// whenever there are any (webgpu-utils fills them only for `mips: true`).
const toLibrary = (o) => ({
    ...o,
    mips: o.mips || o.mipLevelCount > 1,
    ...(o.dimension === 'cube' && { dimension: '2d' }),
});

/** @param {object} gpu OGPU gpu context (renderer.gpu) */
export function createTextureFromSources(gpu, sources, options = {}) {
    return wgu.createTextureFromSources(gpu.device, sources, toLibrary(options));
}

export function createTextureFromSource(gpu, source, options = {}) {
    return wgu.createTextureFromSource(gpu.device, source, toLibrary(options));
}

/** Fetches `urls` as ImageBitmaps (all the same size) and builds a texture from them. */
export function createTextureFromImages(gpu, urls, options = {}) {
    return wgu.createTextureFromImages(gpu.device, urls, toLibrary(options));
}

export function createTextureFromImage(gpu, url, options = {}) {
    return wgu.createTextureFromImage(gpu.device, url, toLibrary(options));
}
