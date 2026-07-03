import { Camera } from '@core/Camera.js';
import { Vec3 } from '@math';
import { generateMipmap, numMipLevels } from 'webgpu-utils';

// Cube-face bases matching the WebGPU cube-map layer order (+x -x +y -y +z -z).
// Ups derived from each face's uv->direction mapping; the horizontal mirror
// left over (cube faces are left-handed from inside) is fixed by negating the
// projection's x column — see constructor.
const FACES = [
    { dir: [1, 0, 0], up: [0, 1, 0] },
    { dir: [-1, 0, 0], up: [0, 1, 0] },
    { dir: [0, 1, 0], up: [0, 0, -1] },
    { dir: [0, -1, 0], up: [0, 0, 1] },
    { dir: [0, 0, 1], up: [0, 1, 0] },
    { dir: [0, 0, -1], up: [0, 1, 0] },
];

/**
 * Box-projected local reflection probe: renders 6 faces of the scene from a
 * point into a cube texture (on demand or on an interval), then builds a mip
 * chain. Consumers sample it with a parallax-corrected (box-projected)
 * direction — see the WGSL snippet in this directory's CLAUDE.md — and use
 * mip level as a roughness approximation (`lod = roughness * maxLod`).
 *
 * TODO(prefilter): v1 mips are plain box downsamples (generateMipmap). Proper
 * GGX-prefiltered roughness sampling should plug into IBLUtils'
 * createDynamicIBL once that lands — swap the generateMipmap call for the
 * prefilter pass and keep the same cube view contract.
 */
export class ReflectionProbe {
    constructor(
        gpu,
        {
            size = 128,
            format = null,
            depthFormat = 'depth24plus',
            near = 0.05,
            far = 100,
            position = [0, 0, 0],
            boxMin = [-1, -1, -1],
            boxMax = [1, 1, 1],
            interval = 0,
            mips = true,
            label = 'reflection-probe',
        } = {}
    ) {
        this.gpu = gpu;
        this.label = label;
        this.size = size;
        this.format = format || gpu.presentationFormat;
        this.interval = interval;

        this.position = new Vec3(position[0], position[1], position[2]);
        this.boxMin = new Vec3(boxMin[0], boxMin[1], boxMin[2]);
        this.boxMax = new Vec3(boxMax[0], boxMax[1], boxMax[2]);

        this.mipLevelCount = mips ? numMipLevels([size, size]) : 1;
        this.cubeTexture = gpu.device.createTexture({
            label: `${label}-cube`,
            size: [size, size, 6],
            format: this.format,
            mipLevelCount: this.mipLevelCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.view = this.cubeTexture.createView({ dimension: 'cube' });

        this.sampler = gpu.device.createSampler({
            label: `${label}-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
        });

        this._depth = gpu.device.createTexture({
            label: `${label}-depth`,
            size: [size, size],
            format: depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Renderer.render attaches target.textures[i].texture.createView() (a
        // full view — wrong for one cube face), so each face gets a minimal
        // RenderTarget-shaped adapter serving a prebuilt single-layer view.
        this._faceTargets = FACES.map((_, i) => {
            const faceView = this.cubeTexture.createView({
                dimension: '2d',
                baseMipLevel: 0,
                mipLevelCount: 1,
                baseArrayLayer: i,
                arrayLayerCount: 1,
            });
            return {
                textures: [{ texture: { createView: () => faceView }, isDestroyed: false }],
                msaaTextures: [],
                depthTexture: this._depth,
                width: size,
                height: size,
            };
        });

        this.camera = new Camera({ fov: 90, aspect: 1, near, far });
        // negate x to undo the handedness mirror of inside-out cube faces
        this.camera.projectionMatrix[0] *= -1;

        this._dirty = true;
        this._lastTime = -Infinity;
    }

    /** Force a re-render on the next tick (or call update() directly). */
    invalidate() {
        this._dirty = true;
    }

    /** Interval-gated update: renders when dirty or `interval` seconds elapsed. */
    tick({ time = 0, ...rest } = {}) {
        if (this._dirty || (this.interval > 0 && time - this._lastTime >= this.interval)) {
            this._lastTime = time;
            this._dirty = false;
            this.update(rest);
        }
    }

    /**
     * Render all 6 faces now. Owns its submit (generateMipmap submits its own
     * encoder, so face renders must land on the queue first). `hide` lists
     * meshes to exclude — typically the probe-lit mesh itself and any planar
     * mirror surfaces (their screen-projected uvs are meaningless here).
     */
    update({ scene, renderer = this.gpu.renderer, hide = [] } = {}) {
        if (!renderer?.isReady) return;

        const hidden = [];
        for (const mesh of hide) {
            if (mesh?.visible) {
                mesh.visible = false;
                hidden.push(mesh);
            }
        }

        scene.updateMatrixWorld();

        const encoder = this.gpu.device.createCommandEncoder({ label: `${this.label}-encoder` });
        for (let i = 0; i < 6; i++) {
            const face = FACES[i];
            this.camera.position.copy(this.position);
            this.camera.up.set(face.up[0], face.up[1], face.up[2]);
            this.camera.lookAt([this.position[0] + face.dir[0], this.position[1] + face.dir[1], this.position[2] + face.dir[2]]);
            this.camera.updateMatrixWorld();
            renderer.render({ scene, camera: this.camera, target: this._faceTargets[i], encoder, updateMatrices: false });
        }
        this.gpu.device.queue.submit([encoder.finish()]);

        if (this.mipLevelCount > 1) generateMipmap(this.gpu.device, this.cubeTexture);

        hidden.forEach((mesh) => (mesh.visible = true));
    }

    destroy() {
        this.cubeTexture.destroy();
        this._depth.destroy();
    }
}
