// Ported from webgpu-utils (https://github.com/greggman/webgpu-utils),
// Copyright (c) Gregg Tavares, MIT License.
import { RenderPipeline } from '@core/RenderPipeline.js';
import { blit } from './RenderUtils.js';
import mipmapShader from './mipmap.wgsl?raw';

// Per-device cache; WeakMap so a lost/destroyed device can be collected.
const byDevice = new WeakMap();

function normalizeGPUExtent3D(size) {
    if (Array.isArray(size) || ArrayBuffer.isView(size)) return [...size, 1, 1].slice(0, 3);
    return [size.width, size.height || 1, size.depthOrArrayLayers || 1];
}

/** Mip levels needed for a GPUExtent3D (3d textures count depth too). */
export function numMipLevels(size, dimension) {
    const sizes = normalizeGPUExtent3D(size);
    const maxSize = Math.max(...sizes.slice(0, dimension === '3d' ? 3 : 2));
    return (1 + Math.log2(maxSize)) | 0;
}

function getInfo(gpu) {
    let info = byDevice.get(gpu.device);
    if (!info) {
        info = {
            pipelines: {},
            sampler: gpu.device.createSampler({
                label: 'mipmap-sampler',
                minFilter: 'linear',
                magFilter: 'linear',
            }),
        };
        byDevice.set(gpu.device, info);
    }
    return info;
}

/**
 * Fills mip levels 1.. of `texture` from level 0 with a render-pass box filter.
 * Needs TEXTURE_BINDING | RENDER_ATTACHMENT and mipLevelCount > 1. Handles 2d,
 * 2d-array, cube and cube-array textures; every layer is filtered through its
 * own 2d view, so no view-dimension argument is needed.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {GPUTexture} texture
 */
export function generateMipmap(gpu, texture) {
    const { device } = gpu;
    const info = getInfo(gpu);

    let pipeline = info.pipelines[texture.format];
    if (!pipeline) {
        pipeline = info.pipelines[texture.format] = new RenderPipeline(gpu, {
            label: `mipmap-${texture.format}`,
            code: mipmapShader,
            vertexBuffers: gpu.TRIANGLE.bufferLayouts,
            targets: [{ format: texture.format }],
            depthStencil: false,
            cullMode: 'none',
        });
    }

    const encoder = device.createCommandEncoder({ label: 'mipmap-encoder' });
    for (let level = 1; level < texture.mipLevelCount; ++level) {
        for (let layer = 0; layer < texture.depthOrArrayLayers; ++layer) {
            const bindGroup = device.createBindGroup({
                label: 'mipmap-bind-group',
                layout: pipeline.bindGroupLayout(0),
                entries: [
                    { binding: 0, resource: info.sampler },
                    {
                        binding: 1,
                        resource: texture.createView({
                            dimension: '2d',
                            baseMipLevel: level - 1,
                            mipLevelCount: 1,
                            baseArrayLayer: layer,
                            arrayLayerCount: 1,
                        }),
                    },
                ],
            });
            blit(encoder, {
                pipeline,
                geometry: gpu.TRIANGLE,
                targetView: texture.createView({
                    dimension: '2d',
                    baseMipLevel: level,
                    mipLevelCount: 1,
                    baseArrayLayer: layer,
                    arrayLayerCount: 1,
                }),
                bindGroup,
                label: 'mipmap-pass',
            });
        }
    }
    device.queue.submit([encoder.finish()]);
}
