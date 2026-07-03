import { RenderTarget } from '@core/RenderTarget.js';
import { Camera } from '@core/Camera.js';
import { FullscreenPass } from '../post/FullscreenPass.js';
import { Vec3, Mat4 } from '@math';
import { reflectionMatrix, transformPlane, obliqueProjection } from '@utils/Mat4Utils.js';
import blurDownShader from './blur_down.wgsl?raw';

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

/**
 * Planar mirror: renders the scene a second time from a camera reflected
 * across a plane, with an oblique near-plane clip (Lengyel) so nothing behind
 * the mirror leaks into the reflection. No compute — plain raster pass into an
 * owned RenderTarget, optionally followed by a Kawase downsample mip chain for
 * glossy (roughness -> lod) reflections. Pair with `planar.wgsl` on the mirror
 * mesh.
 *
 * Content rendered into the reflection has flipped winding (reflection is a
 * handedness flip) — build content pipelines with `cullMode: 'none'` (or
 * 'front') if they must appear in mirrors.
 */
export class PlanarReflector {
    constructor(gpu, { resolutionScale = 0.5, matchPost = false, format = null, depthFormat = null, mipLevels = 1, width = null, height = null, label = 'planar-reflector' } = {}) {
        this.gpu = gpu;
        this.label = label;
        this.resolutionScale = resolutionScale;
        this.matchPost = matchPost;

        // Format trap: scene pipelines compiled against the post composer's MRT
        // (rgba16float x2 + depth32float) can't render into a differently
        // formatted target — matchPost mirrors that layout (the normal
        // attachment is wasted, accepted for v1). Plain apps get a single
        // swapchain-format attachment + depth24plus.
        this.colorFormat = matchPost ? 'rgba16float' : format || gpu.presentationFormat;
        this.depthFormat = depthFormat || (matchPost ? 'depth32float' : 'depth24plus');

        // scaled-tier size: 1.0 exact, 0.5 half, 0.25 rough
        this._autoSize = width === null && height === null;
        this.width = Math.max(2, Math.floor((width ?? gpu.canvas.width) * (this._autoSize ? resolutionScale : 1)));
        this.height = Math.max(2, Math.floor((height ?? gpu.canvas.height) * (this._autoSize ? resolutionScale : 1)));

        const textures = matchPost
            ? [
                  { format: this.colorFormat, usage: USAGE, label: 'color' },
                  { format: 'rgba16float', usage: USAGE, label: 'normal' },
              ]
            : [{ format: this.colorFormat, usage: USAGE, label: 'color' }];

        this.target = new RenderTarget(
            gpu,
            {
                label: `${label}-target`,
                width: this.width,
                height: this.height,
                depthTexture: true,
                depthFormat: this.depthFormat,
            },
            textures
        );

        this.mipLevels = Math.max(1, mipLevels);
        this.blur = this.mipLevels > 1;
        if (this.mipLevels > 1) {
            this._blurPass = new FullscreenPass(gpu, {
                label: `${label}-blur-down`,
                code: blurDownShader,
                targets: [{ format: this.colorFormat }],
            });
            this._blurPass.uniforms.set({ offset: 1 });
        }

        // mip-filtering sampler for the surface material (roughness -> lod)
        this.sampler = gpu.device.createSampler({
            label: `${label}-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this._buildMipChain();

        // Mirrored camera. Its matrices are written directly each frame
        // (reflection has det -1, not representable as TRS), so renders use
        // updateMatrices: false. quaternion stays identity — shaders reading
        // cameraQuaternion (billboards) are approximate inside reflections.
        this.camera = new Camera();

        this.plane = { normal: new Vec3(0, 1, 0), constant: 0 };
        this.obliqueClip = true;
        // small slack below the plane avoids clipping seams at the mirror surface
        this.clipBias = 0.003;

        this.surfaces = [];
        this._reflMat = new Mat4();
        this._planeV4 = new Float32Array(4);
        this._viewPlane = new Float32Array(4);
        this._rebuildHandlers = new Set();

        this._unsubResize = this._autoSize ? gpu.renderer?.addResizeHandler?.((w, h) => this.setSize(w, h)) : null;
    }

    get maxLod() {
        return this._mipLevelCount - 1;
    }

    /** Texture view the mirror-surface material binds as tReflection. */
    get view() {
        return this._view;
    }

    /** World-space plane through `point` with unit `normal` (facing the reflected content). */
    setPlane(normal, point = [0, 0, 0]) {
        this.plane.normal.set(normal[0], normal[1], normal[2]).normalize();
        this.plane.constant = -this.plane.normal.dot(point);
        return this;
    }

    /** Register the mirror mesh drawn with this reflector — hidden during its own reflection pass. */
    addSurface(mesh) {
        this.surfaces.push(mesh);
        return mesh;
    }

    /** Fired after target/mip textures are recreated (resize) — rebuild surface bind groups here. Returns unsubscribe fn. */
    addRebuildHandler(cb) {
        this._rebuildHandlers.add(cb);
        return () => this._rebuildHandlers.delete(cb);
    }

    /** Convenience group(0) for a planar.wgsl pipeline: uniforms + reflectionSampler + tReflection. */
    bindGroup(pipeline, uniformBuffer) {
        return this.gpu.device.createBindGroup({
            label: `${this.label}-surface-bind-group`,
            layout: pipeline.bindGroupLayout(0),
            entries: [
                { binding: pipeline.defs.uniforms.uniforms.binding, resource: { buffer: uniformBuffer } },
                { binding: pipeline.defs.samplers.reflectionSampler.binding, resource: this.sampler },
                { binding: pipeline.defs.textures.tReflection.binding, resource: this.view },
            ],
        });
    }

    setResolutionScale(scale) {
        this.resolutionScale = scale;
        if (this._autoSize) this.setSize(this.gpu.canvas.width, this.gpu.canvas.height);
    }

    setSize(width, height) {
        const scale = this._autoSize ? this.resolutionScale : 1;
        const w = Math.max(2, Math.floor(width * scale));
        const h = Math.max(2, Math.floor(height * scale));
        if (w === this.width && h === this.height) return;
        this.width = w;
        this.height = h;

        const oldDepth = this.target.depthTexture;
        this.target.onResize({ width: w, height: h });
        // belt-and-braces vs the RenderTarget depth-leak gotcha
        if (oldDepth && oldDepth !== this.target.depthTexture) oldDepth.destroy();

        this._buildMipChain();
        this._rebuildHandlers.forEach((cb) => cb?.(this));
    }

    _buildMipChain() {
        this._mipTexture?.destroy?.();
        this._mipTexture = null;
        this._mipViews = [];

        const maxMips = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
        this._mipLevelCount = Math.min(this.mipLevels, maxMips);

        if (this._mipLevelCount > 1) {
            // Renderer.render attaches full-mip views, so the scene renders into a
            // single-mip target and gets copied here before the downsample chain.
            this._mipTexture = this.gpu.device.createTexture({
                label: `${this.label}-mip-chain`,
                size: [this.width, this.height],
                format: this.colorFormat,
                mipLevelCount: this._mipLevelCount,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            for (let i = 0; i < this._mipLevelCount; i++) {
                this._mipViews.push(this._mipTexture.createView({ dimension: '2d', baseMipLevel: i, mipLevelCount: 1 }));
            }
            this._view = this._mipTexture.createView();
        } else {
            this._view = this.target.createView(0);
        }
    }

    // Mirror the main camera across the plane and fold the plane into the
    // projection as an oblique near plane. viewMirror = view · R (R involutory).
    reflectCamera(camera, plane = this.plane) {
        const { normal, constant } = plane;
        reflectionMatrix(normal, constant, this._reflMat);

        const cam = this.camera;
        cam.viewMatrix.copy(camera.viewMatrix).multiply(this._reflMat);
        cam.worldMatrix.copy(cam.viewMatrix).invert();
        cam.worldMatrix.getTranslation(cam.worldPosition);
        cam.projectionMatrix.copy(camera.projectionMatrix);

        if (this.obliqueClip) {
            this._planeV4[0] = normal[0];
            this._planeV4[1] = normal[1];
            this._planeV4[2] = normal[2];
            this._planeV4[3] = constant;
            // keep the main camera's side: flip if it sits below the plane
            const side = normal.dot(camera.worldPosition) + constant;
            if (side < 0) for (let i = 0; i < 4; i++) this._planeV4[i] *= -1;

            transformPlane(this._planeV4, cam.worldMatrix, this._viewPlane);
            this._viewPlane[3] += this.clipBias;
            obliqueProjection(cam.projectionMatrix, this._viewPlane, cam.projectionMatrix);
        }

        cam.projectionViewMatrix.copy(cam.projectionMatrix).multiply(cam.viewMatrix);
        return cam;
    }

    /**
     * Render the reflection. Call once per frame BEFORE the main render (or
     * the frame encoder's creation). Always submits its own encoder: a mesh's
     * uniform buffer is written at encode time via queue.writeBuffer, so if
     * the reflection pass shared a submit with another pass drawing the same
     * meshes, the last pass's camera uniforms would win for BOTH passes
     * (writeBuffer ops all land before the command buffer executes). A
     * separate submit flushes this pass's uniforms first.
     * `hide` lists extra meshes to exclude (e.g. another mirror's surface —
     * mirror-in-mirror recursion isn't supported).
     */
    render({ scene, camera, renderer = this.gpu.renderer, hide = [] } = {}) {
        if (!renderer?.isReady) return;

        camera.updateMatrixWorld();
        scene.updateMatrixWorld();
        this.reflectCamera(camera);

        const hidden = [];
        for (const mesh of [...this.surfaces, ...hide]) {
            if (mesh?.visible) {
                mesh.visible = false;
                hidden.push(mesh);
            }
        }

        const enc = this.gpu.device.createCommandEncoder({ label: `${this.label}-encoder` });

        renderer.render({ scene, camera: this.camera, target: this.target, encoder: enc, updateMatrices: false });

        if (this._mipTexture) {
            enc.copyTextureToTexture({ texture: this.target.textures[0].texture }, { texture: this._mipTexture }, [this.width, this.height]);
            if (this.blur) {
                for (let i = 1; i < this._mipLevelCount; i++) {
                    this._blurPass.setBindings({ tMap: this._mipViews[i - 1], mapSampler: this.sampler }, `mip-${i}`);
                    this._blurPass.draw(enc, { view: this._mipViews[i], bindKey: `mip-${i}` });
                }
            }
        }

        this.gpu.device.queue.submit([enc.finish()]);

        hidden.forEach((mesh) => (mesh.visible = true));
    }

    dispose() {
        this._unsubResize?.();
        this._blurPass?.dispose?.();
        this._mipTexture?.destroy?.();
        this.target.destroy();
        this._rebuildHandlers.clear();
    }
}
