// Ported from webgpu-utils (https://github.com/greggman/webgpu-utils),
// Copyright (c) Gregg Tavares, MIT License.
import { generateMipmap, numMipLevels } from './mipmap.js';

// Texture-from-source helpers. Sources are anything
// copyExternalImageToTexture accepts (ImageBitmap, canvas, video, ...) or raw
// texel data (typed array, array, or { data }). Unlike the originals these take
// the OGPU `gpu` object, because mip generation builds a RenderPipeline.

const isTypedArray = (arr) => arr && typeof arr.length === 'number' && arr.buffer instanceof ArrayBuffer;

const kFormatToTypedArray = {
    '8snorm': Int8Array,
    '8unorm': Uint8Array,
    '8sint': Int8Array,
    '8uint': Uint8Array,
    '16snorm': Int16Array,
    '16unorm': Uint16Array,
    '16sint': Int16Array,
    '16uint': Uint16Array,
    '32snorm': Int32Array,
    '32unorm': Uint32Array,
    '32sint': Int32Array,
    '32uint': Uint32Array,
    '16float': Uint16Array,
    '32float': Float32Array,
};

// regex only covers common formats (rgba8unorm, r32float, ...)
function getTextureFormatInfo(format) {
    const [, channels, bits, typeName] = /([a-z]+)(\d+)([a-z]+)/.exec(format);
    const bytesPerChannel = parseInt(bits) / 8;
    return {
        numChannels: channels.length,
        bytesPerChannel,
        bytesPerElement: channels.length * bytesPerChannel,
        Type: kFormatToTypedArray[`${bits}${typeName}`],
    };
}

function isRawData(source) {
    return isTypedArray(source) || Array.isArray(source) || isTypedArray(source.data) || Array.isArray(source.data);
}

function toTypedArray(v, format) {
    if (isTypedArray(v)) return v;
    const { Type } = getTextureFormatInfo(format);
    return new Type(v);
}

function guessDimensions(width, height, numElements) {
    if (numElements % 1 !== 0) throw new Error("can't guess dimensions");
    if (!width && !height) {
        const size = Math.sqrt(numElements);
        if (size % 1 === 0) {
            width = size;
            height = size;
        } else {
            width = numElements;
            height = 1;
        }
    } else if (!height) {
        height = numElements / width;
        if (height % 1) throw new Error("can't guess dimensions");
    } else if (!width) {
        width = numElements / height;
        if (width % 1) throw new Error("can't guess dimensions");
    }
    const depth = numElements / width / height;
    if (depth % 1) throw new Error("can't guess dimensions");
    return [width, height, depth];
}

function guessViewDimension(dimension, depthOrArrayLayers) {
    switch (dimension) {
        case '1d':
            return '1d';
        case '3d':
            return '3d';
        default:
            return depthOrArrayLayers > 1 ? '2d-array' : '2d';
    }
}

function viewDimensionToDimension(viewDimension) {
    return viewDimension === '1d' || viewDimension === '3d' ? viewDimension : '2d';
}

function getSizeFromSource(source, options) {
    if ('videoWidth' in source && 'videoHeight' in source) {
        return [source.videoWidth, source.videoHeight, 1];
    }
    const { width, height } = source;
    if (width > 0 && height > 0 && !isRawData(source)) return [width, height, 1];

    const { bytesPerElement, bytesPerChannel } = getTextureFormatInfo(options.format || 'rgba8unorm');
    const data = isTypedArray(source) || Array.isArray(source) ? source : source.data;
    const numBytes = isTypedArray(data) ? data.byteLength : data.length * bytesPerChannel;
    return guessDimensions(width, height, numBytes / bytesPerElement);
}

function uploadData(device, texture, source, origin) {
    const data = toTypedArray(source.data || source, texture.format);
    const size = [texture.width, texture.height, texture.depthOrArrayLayers];
    const { bytesPerElement } = getTextureFormatInfo(texture.format);
    device.queue.writeTexture({ texture, origin }, data, { bytesPerRow: bytesPerElement * size[0], rowsPerImage: size[1] }, size);
}

function copySourcesToTexture(gpu, texture, sources, options = {}) {
    const { device } = gpu;
    let tempTexture;
    sources.forEach((source, layer) => {
        const origin = [0, 0, layer + (options.baseArrayLayer || 0)];
        if (isRawData(source)) {
            uploadData(device, texture, source, origin);
            return;
        }
        // copyExternalImageToTexture can't target a 3d texture (gpuweb#4697): bounce via 2d
        let dstTexture = texture;
        let copyOrigin = origin;
        if (texture.dimension === '3d') {
            tempTexture ??= device.createTexture({
                format: texture.format,
                usage: texture.usage | GPUTextureUsage.COPY_SRC,
                size: [texture.width, texture.height, 1],
            });
            dstTexture = tempTexture;
            copyOrigin = [0, 0, 0];
        }
        const { flipY, premultipliedAlpha, colorSpace } = options;
        device.queue.copyExternalImageToTexture({ source, flipY }, { texture: dstTexture, premultipliedAlpha, colorSpace, origin: copyOrigin }, getSizeFromSource(source, options));
        if (tempTexture) {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToTexture({ texture: tempTexture }, { texture, origin }, tempTexture);
            device.queue.submit([encoder.finish()]);
        }
    });
    tempTexture?.destroy();

    if (texture.mipLevelCount > 1) generateMipmap(gpu, texture);
}

/**
 * Creates a texture from sources (ImageBitmap, canvas, video, raw data), one per
 * layer; all must share a size. `mips: true` allocates a full chain unless
 * `mipLevelCount` is set, and fills it.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {Array} sources
 * @param {object} [options] mips, mipLevelCount, flipY, premultipliedAlpha, colorSpace,
 *   format, usage, dimension, viewDimension
 */
export function createTextureFromSources(gpu, sources, options = {}) {
    const size = getSizeFromSource(sources[0], options);
    size[2] = size[2] > 1 ? size[2] : sources.length;
    const viewDimension = options.viewDimension ?? guessViewDimension(options.dimension, size[2]);
    const texture = gpu.device.createTexture({
        dimension: viewDimensionToDimension(viewDimension),
        textureBindingViewDimension: viewDimension,
        format: options.format || 'rgba8unorm',
        mipLevelCount: options.mipLevelCount ? options.mipLevelCount : options.mips ? numMipLevels(size) : 1,
        size,
        usage: (options.usage ?? 0) | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    copySourcesToTexture(gpu, texture, sources, options);
    return texture;
}

export function createTextureFromSource(gpu, source, options = {}) {
    return createTextureFromSources(gpu, [source], options);
}

async function loadImageBitmap(url) {
    const res = await fetch(url);
    return createImageBitmap(await res.blob());
}

/** Fetches `urls` as ImageBitmaps (all the same size) and builds a texture from them. */
export async function createTextureFromImages(gpu, urls, options = {}) {
    const bitmaps = await Promise.all(urls.map((url) => loadImageBitmap(url)));
    return createTextureFromSources(gpu, bitmaps, options);
}

export function createTextureFromImage(gpu, url, options = {}) {
    return createTextureFromImages(gpu, [url], options);
}
