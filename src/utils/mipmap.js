// Mip chains: webgpu-utils' generateMipmap / numMipLevels, taking the OGPU `gpu`
// object like the rest of the engine.
import { generateMipmap as generate, numMipLevels } from 'webgpu-utils';

/** Mip levels needed for a GPUExtent3D (3d textures count depth too). */
export { numMipLevels };

/**
 * Fills mip levels 1.. of `texture` from level 0 with a render-pass box filter,
 * every layer separately (2d, 2d-array and cube; webgpu-utils caches its
 * pipelines per device). Needs TEXTURE_BINDING | RENDER_ATTACHMENT and
 * mipLevelCount > 1.
 * @param {object} gpu OGPU gpu context (renderer.gpu)
 * @param {GPUTexture} texture
 */
export function generateMipmap(gpu, texture) {
    generate(gpu.device, texture);
}
