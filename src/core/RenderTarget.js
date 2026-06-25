import { Texture } from './Texture';

// Owns color Texture(s) (MRT) + optional MSAA resolve + optional depth; render off-screen.
//TODO: MSAA
export class RenderTarget {
    constructor(
        gpu,
        {
            width = 1280,
            height = 720,
            depth = 1,
            format = 'bgra8unorm',
            dimension = '2d',
            color = true,
            depthTexture = false,
            depthFormat = 'depth24plus',
            sampleCount = 1,
            generateMipmaps = false,
            mipLevelCount = 1,
            usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label = '',
        } = {},
        textures = []
    ) {
        this.gpu = gpu;
        this.label = label;

        this.width = width;
        this.height = height;
        this.depth = depth;
        this.sampleCount = sampleCount;
        // color=false -> depth-only target (shadow maps): no color attachment,
        // just a sampleable depth texture in depthFormat.
        // ponytail: depth-only. A combined depth+stencil format (depth24plus-stencil8,
        // depth32float-stencil8) creates fine here, but Renderer's depthStencilAttachment
        // only sets depth load/store ops — wire stencilLoadOp/stencilStoreOp +
        // pipeline stencil state when an actual stencil pass needs it.
        this.color = color;
        this.depthFormat = depthFormat;

        this.textureParams = {
            format,
            dimension,
            generateMipmaps,
            usage,
            mipLevelCount,
        };

        //contains settings for each attachment.
        //each attachment will abide to the same dimensions and usage settings
        this._textures = textures;

        this.msaaTextures = [];
        this.textures = [];

        this.createTextures();

        depthTexture && this.createDepthTexture();

        this.onResize({ width: this.width, height: this.height });
    }

    createTextures() {
        if (!this.color) {
            this.texture = undefined;
            return;
        }

        if (this._textures.length > 0) {
            this._textures.forEach((t) => {
                const args = {
                    width: this.width,
                    height: this.height,
                    depth: this.depth,
                    format: t.format,
                    dimension: this.textureParams.dimension,
                    sampleCount: 1,
                    generateMipmaps: this.textureParams.generateMipmaps,
                    mipLevelCount: this.textureParams.mipLevelCount,
                    usage: t.usage,
                    label: `${this.label}-${t.label}-buffer`,
                };

                if (this.sampleCount > 1) {
                    const mssaArgs = { ...args };
                    mssaArgs.sampleCount = this.sampleCount;
                    mssaArgs.usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
                    this.msaaTextures.push(new Texture(this.gpu, mssaArgs));
                }
                this.textures.push(new Texture(this.gpu, args));
            });
        } else {
            const args = {
                width: this.width,
                height: this.height,
                depth: this.depth,
                format: this.textureParams.format,
                dimension: this.textureParams.dimension,
                sampleCount: 1,
                generateMipmaps: this.textureParams.generateMipmaps,
                mipLevelCount: this.textureParams.mipLevelCount,
                usage: this.textureParams.usage,
                label: `${this.label}-texture`,
            };

            if (this.sampleCount > 1) {
                const mssaArgs = { ...args };
                mssaArgs.sampleCount = this.sampleCount;
                mssaArgs.usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
                this.msaaTextures.push(new Texture(this.gpu, mssaArgs));
            }
            this.textures.push(new Texture(this.gpu, args));
        }

        this.texture = this.textures[0];
    }

    createDepthTexture() {
        this.depthTexture && this?.depthTexture?.destroy?.();

        this.depthTexture = this.gpu.device.createTexture({
            size: [this.width, this.height],
            format: this.depthFormat,
            sampleCount: this.sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    // View of attachment i (defaults to primary). Routes through Texture.createView
    // so cube targets get the right dimension.
    createView(i = 0) {
        return this.textures[i].createView();
    }

    getTargets() {
        return this.textures.map((t) => {
            return { format: t.format, usage: t.usage };
        });
    }

    destroy() {
        this.textures.forEach((t) => t.destroy());
        this.msaaTextures.forEach((t) => t.destroy());
        this.depthTexture?.destroy?.();
    }

    onResize({ width, height, depth } = {}) {
        if ((width > 0 && height > 0) || (width > 0 && height > 0) || depth > 0) {
            this.width = width;
            this.height = height;
            this.depth = depth;

            if (this.textures.length > 0) {
                this.textures.forEach((texture) => {
                    texture.update({
                        width: this.width,
                        height: this.height,
                        depth: this.depth,
                        format: texture.format,
                        usage: texture.usage,
                        sampleCount: 1,
                        mipLevelCount: this.textureParams.mipLevelCount,
                    });
                });

                if (this.msaaTextures.length > 0) {
                    this.msaaTextures.forEach((texture) => {
                        texture.update({
                            width: this.width,
                            height: this.height,
                            depth: this.depth,
                            format: texture.format,
                            usage: texture.usage,
                            sampleCount: this.sampleCount,
                            mipLevelCount: this.textureParams.mipLevelCount,
                        });
                    });
                }
            }

            this.depthTexture && this.createDepthTexture();
        }
    }
}
