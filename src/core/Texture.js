import { createTextureFromImages, createTextureFromSources, createTextureFromImage, createTextureFromSource } from 'webgpu-utils';

let TEXTURE_ID = 1;

// Destroy/recreate GPUTexture wrapper (format→bpp table, mip upload).
export class Texture {
    constructor(
        gpu,
        {
            width = 2,
            height = 2,
            depth = 1,
            data = null,
            format = 'rgba8unorm',
            dimension = '2d',
            sampleCount = 1,
            generateMipmaps = false,
            mips = false,
            mipLevelCount = 1,
            usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label = '',
            isCubeMap = false,
            src = null,
            flipY = false,
        } = {}
    ) {
        this.gpu = gpu;
        this.id = TEXTURE_ID++;
        this.label = `Texture ${this.id}: ${label}`;
        this.isDestroyed = true;
        this.generateMipmaps = generateMipmaps;
        this.isCubeMap = isCubeMap;

        if (src !== null && src !== undefined) {
            // Async path — src may be a URL string, an array of URL strings,
            // a decoded source, or an array of decoded sources.
            this.texture = null;
            const opts = {
                mips: mips || generateMipmaps,
                flipY,
                format,
                usage,
                dimension: isCubeMap ? 'cube' : dimension,
                label: this.label,
            };
            const device = gpu.device;
            const srcArray = Array.isArray(src) ? src : [src];
            const isUrl = typeof srcArray[0] === 'string';

            let loadPromise;
            if (isUrl) {
                if (srcArray.length === 1) {
                    loadPromise = createTextureFromImage(device, srcArray[0], opts);
                } else {
                    loadPromise = createTextureFromImages(device, srcArray, opts);
                }
            } else {
                if (srcArray.length === 1) {
                    loadPromise = Promise.resolve(createTextureFromSource(device, srcArray[0], opts));
                } else {
                    loadPromise = Promise.resolve(createTextureFromSources(device, srcArray, opts));
                }
            }

            this.ready = loadPromise.then((texture) => {
                this.texture = texture;
                this.width = texture.width;
                this.height = texture.height;
                this.depth = texture.depthOrArrayLayers;
                this.format = texture.format;
                this.dimension = texture.dimension;
                this.usage = texture.usage;
                this.sampleCount = texture.sampleCount;
                this.mipLevelCount = texture.mipLevelCount;
                this.isDestroyed = false;
                return this;
            });
        } else {
            // Synchronous path — unchanged behaviour for callers that pass
            // width/height/data/format/etc. directly.
            this.update({
                width,
                height,
                depth,
                data,
                format,
                dimension,
                usage,
                sampleCount,
                generateMipmaps,
                mipLevelCount,
            });
            this.ready = Promise.resolve(this);
        }
    }

    update({
        width = 2,
        height = 2,
        depth = 1,
        data,
        format = 'rgba8unorm',
        dimension = '2d',
        usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        sampleCount = 1,
        mipLevelCount = 1,
    } = {}) {
        const needsInit =
            width !== this.width ||
            height !== this.height ||
            depth !== this.depth ||
            format !== this.format ||
            usage !== this.usage ||
            dimension !== this.dimension ||
            sampleCount !== this.sampleCount ||
            mipLevelCount !== this.mipLevelCount ||
            !this.texture;

        if (needsInit) {
            this.destroy();
            this.texture = this.gpu.device.createTexture({
                label: this.label,
                size: depth > 1 ? [width, height, depth] : [width, height],
                format,
                usage,
                dimension,
                sampleCount,
                mipLevelCount,
            });
            this.isDestroyed = false;
        }

        this.width = width;
        this.height = height;
        this.depth = depth;
        this.format = format;
        this.dimension = dimension;
        this.usage = usage;
        this.sampleCount = sampleCount;
        this.mipLevelCount = mipLevelCount;

        //no need to upload data if texture is used as a render attachment
        const isRenderAttachment = (usage & GPUTextureUsage.RENDER_ATTACHMENT) !== 0;
        if (data && !isRenderAttachment && this.texture) {
            this.data = data;

            let bytesPerPixel;
            switch (format) {
                case 'r8unorm':
                case 'r8snorm':
                case 'r8uint':
                case 'r8sint':
                    bytesPerPixel = 1;
                    break;

                case 'r16uint':
                case 'r16sint':
                case 'r16float':
                case 'rg8unorm':
                case 'rg8snorm':
                case 'rg8uint':
                case 'rg8sint':
                    bytesPerPixel = 2;
                    break;

                case 'r32uint':
                case 'r32sint':
                case 'r32float':
                case 'rg16uint':
                case 'rg16sint':
                case 'rg16float':
                case 'rgba8unorm':
                case 'rgba8unorm-srgb':
                case 'rgba8snorm':
                case 'rgba8uint':
                case 'rgba8sint':
                case 'bgra8unorm':
                case 'bgra8unorm-srgb':
                case 'rgb10a2unorm':
                case 'rg11b10ufloat':
                case 'rgb9e5ufloat':
                    bytesPerPixel = 4;
                    break;

                case 'rg32uint':
                case 'rg32sint':
                case 'rg32float':
                case 'rgba16uint':
                case 'rgba16sint':
                case 'rgba16float':
                    bytesPerPixel = 8;
                    break;

                case 'rgba32uint':
                case 'rgba32sint':
                case 'rgba32float':
                    bytesPerPixel = 16;
                    break;

                default:
                    bytesPerPixel = 4;
                    break;
            }

            let _data = this.data instanceof Array ? this.data : [this.data];

            _data.forEach((data, i) => {
                if (this.generateMipmaps && this.mipLevelCount > 1) {
                    for (let mipLevel = 0; mipLevel < this.mipLevelCount; mipLevel++) {
                        const mipWidth = Math.max(1, this.width >> mipLevel);
                        const mipHeight = Math.max(1, this.height >> mipLevel);
                        const mipDepth = Math.max(1, this.depth >> mipLevel);
                        this.gpu.device.queue.writeTexture(
                            {
                                texture: this.texture,
                                mipLevel,
                                origin: [0, 0, i],
                            },
                            data[mipLevel],
                            { bytesPerRow: mipWidth * bytesPerPixel, rowsPerImage: mipHeight },
                            {
                                width: mipWidth,
                                height: mipHeight,
                                depthOrArrayLayers: this.isCubeMap ? 1 : mipDepth,
                            }
                        );
                    }
                } else {
                    this.gpu.device.queue.writeTexture(
                        {
                            texture: this.texture,
                            mipLevel: 0,
                            origin: [0, 0, i],
                        },
                        data,
                        { bytesPerRow: this.width * bytesPerPixel, rowsPerImage: this.height },
                        {
                            width: this.width,
                            height: this.height,
                            depthOrArrayLayers: this.isCubeMap ? 1 : this.depth,
                        }
                    );
                }
            });

            _data = null;
            this.data = null;
        }
    }

    createView() {
        if (this.isCubeMap) {
            return this.texture.createView({ dimension: 'cube', arrayLayerCount: 6 });
        }
        return this.texture.createView();
    }

    destroy() {
        this?.texture && this?.texture?.destroy?.();
        this.texture = null;
        this.isDestroyed = true;
    }
}
