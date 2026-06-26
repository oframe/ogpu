import { Vec3 } from '@math';
import { TimingHelper } from '@utils/TimingHelper';
import { NonNegativeRollingAverage } from '@utils/miscutils';
import { getPromise } from '@utils/utils';

const tempVec3 = /* @__PURE__ */ new Vec3(0, 0, 0);

export class Renderer {
    constructor({ canvas = null, dpr = null, transparent = false, depth = true, stencil = true } = {}) {
        this.canvas = canvas;
        this.dpr = dpr || Math.min(2, devicePixelRatio);
        this.width = 2;
        this.height = 2;

        this.depth = depth;
        this.stencil = stencil;
        this.transparent = transparent;
        this.setClearColor();

        this.time = 0;
        this.deltaTime = 0;
        this.prevTime = 0;
        this.paused = false;

        this.callBacks = new Set();
        // Device-loss recovery hooks. App code registers here to rebuild its own
        // GPU resources after a lost device — pipelines/buffers/textures/bind
        // groups are tied to the dead device and the engine can't revive them.
        this.deviceLostHandlers = new Set();
        this.deviceRestoredHandlers = new Set();
        this.resizeHandlers = new Set();
        this.ready = getPromise();
        this.isReady = false;
        // first initDevice() runs init() (one-time canvas/handler setup); later
        // re-acquisitions run _restore() instead.
        this._initialized = false;

        // Boot lifecycle: tracks async setup (trackCompile) until first render,
        // its promises settle, and a couple frames have painted. The engine emits
        // progress + completion to subscribers (addBootProgressHandler /
        // addBootCompleteHandler) and owns no DOM — a loader UI (see
        // examples/Loader.js) drives the overlay off these hooks.
        this._bootPromises = [];
        this._bootStarted = false;
        this.bootProgressHandlers = new Set();
        this.bootCompleteHandlers = new Set();

        this.initDevice();
    }

    async initDevice() {
        if (!navigator.gpu) {
            console.error('this browser does not support WebGPU');
            this.ready.reject();
            return;
        }

        const adapter = await navigator.gpu?.requestAdapter({
            powerPreference: 'high-performance',
        });
        if (!adapter) {
            console.error('this browser supports webgpu but it appears disabled');
            this.ready.reject();
            return;
        }

        // Features we'd like, in preference order. WebGPU's requiredFeatures is
        // all-or-nothing: listing one the adapter lacks makes requestDevice
        // reject and the engine fail to boot. So request only what this adapter
        // actually exposes — feature-detect, don't demand. Code paths that use
        // optional features must guard on `device.features.has(...)` themselves
        // (e.g. TimingHelper gates on 'timestamp-query'). Fork note: trim this
        // list to your real needs; the texture-compression families in
        // particular are platform-split (astc/etc2 ≈ mobile/Apple, bc ≈ desktop)
        // and a single GPU rarely has all of them.
        const wantedFeatures = [
            'bgra8unorm-storage',
            'core-features-and-limits',
            'depth-clip-control',
            'depth32float-stencil8',
            // 'float16-renderable',
            'float32-blendable',
            'float32-filterable',
            // 'float32-renderable',
            'indirect-first-instance',
            'rg11b10ufloat-renderable',
            'shader-f16',
            'texture-compression-astc',
            'texture-compression-astc-sliced-3d',
            'texture-compression-bc',
            'texture-compression-bc-sliced-3d',
            'texture-compression-etc2',
            'timestamp-query',
            'texture-format-tier1',
            'texture-format-tier2',
        ];

        const requiredFeatures = wantedFeatures.filter((f) => adapter.features.has(f));
        const missingFeatures = wantedFeatures.filter((f) => !adapter.features.has(f));
        if (missingFeatures.length) {
            console.warn('WebGPU features unavailable on this adapter:', missingFeatures.join(', '));
        }

        const device = await adapter?.requestDevice({
            requiredLimits: {
                maxBufferSize: Math.min(2147483644, adapter.limits.maxBufferSize),
                maxStorageBufferBindingSize: Math.min(2147483644, adapter.limits.maxStorageBufferBindingSize),
                maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage),
            },
            requiredFeatures,
        });

        // KTX reader is device-independent — load once, reuse across recoveries.
        if (!window.ktx) {
            const ktxReady = getPromise();

            await window
                .createKtxReadModule({
                    locateFile: (p) => (p.endsWith('.wasm') ? `${import.meta.env.BASE_URL}libktx_read.wasm` : p),
                })
                .then((ktx) => {
                    window.ktx = ktx;
                    ktxReady.resolve();
                });

            await ktxReady;
        }

        this.gpuAverage ??= new NonNegativeRollingAverage();
        this.timingHelper = new TimingHelper(device); // bound to the device, remake each time

        // device.lost resolves once, for the first loss of THIS device, so it's
        // freshly armed for every device we acquire. reason 'destroyed' means a
        // deliberate teardown — don't fight it.
        device.lost.then((info) => this._onDeviceLost(info));

        if (this._initialized) {
            this._restore(device);
        } else {
            this.init(device);
        }
    }

    init(device) {
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'web-gpu-canvas';
            document.body.appendChild(this.canvas);
        }

        this._configureContext(device);

        this.isReady = true;
        this._initialized = true;

        this._debug = new URLSearchParams(location.search).has('debug');

        this.addHandlers();

        this._startLoop();

        this.ready.resolve();
    }

    // Point the canvas's WebGPU context at `device`. Run on boot and again on
    // every recovery — same canvas/context object, reconfigured for the new
    // device.
    _configureContext(device) {
        this.gpu = this.canvas.getContext('webgpu');
        this.gpu.device = device;
        this.gpu.renderer = this;

        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.gpu.configure({
            device,
            format: this.presentationFormat,
            alphamode: this.transparent ? 'premultiplied' : '',
        });

        this.gpu.presentationFormat = this.presentationFormat;
    }

    // device.lost handler. Drops isReady so the render loop bails before it
    // reschedules (see update()), notifies app code, then re-acquires a device
    // unless the loss was a deliberate destroy().
    _onDeviceLost(info) {
        console.error(`WebGPU device was lost: ${info.message} (reason: ${info.reason})`);
        this.isReady = false;
        this._deviceLost = true;
        this.deviceLostHandlers.forEach((cb) => cb?.(info));
        if (info.reason !== 'destroyed') this.initDevice();
    }

    // Recovery path once a fresh device is acquired: reconfigure the context,
    // remake engine-owned GPU state (depth texture), hand app code the new `gpu`
    // so it can rebuild ITS resources (pipelines/buffers/textures/bind groups —
    // all dead with the old device), then restart the loop.
    _restore(device) {
        this._configureContext(device);

        // Old depth texture belonged to the dead device. Drop the reference
        // without destroy() (destroying a lost device's resources is a no-op at
        // best, a warning at worst) and remake at the current canvas size.
        this.depthTexture = null;
        this.depth && this.createDepthTexture();

        this.isReady = true;
        this._deviceLost = false;

        this.deviceRestoredHandlers.forEach((cb) => cb?.(this.gpu));

        this._startLoop();
        console.log('[webgpu] device restored');
    }

    // Single-owner RAF loop. Idempotent: if a loop is already live this is a
    // no-op, so a restore that races the dying loop can't spawn a second one.
    _startLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;
        this._rafHandle = requestAnimationFrame(this.update);
    }

    createDepthTexture() {
        this.depthTexture && this?.depthTexture?.destroy?.();

        this.depthTexture = this.gpu.device.createTexture({
            size: [this.gpu.canvas.width, this.gpu.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    addHandlers() {
        const resizeObserver = new ResizeObserver(this.handleResize);
        try {
            resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
        } catch {
            resizeObserver.observe(this.canvas, { box: 'content-box' });
        }

        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    handleResize = (entries) => {
        for (const entry of entries) {
            const width = entry.devicePixelContentBoxSize?.[0].inlineSize || entry.contentBoxSize[0].inlineSize * this.dpr;
            const height = entry.devicePixelContentBoxSize?.[0].blockSize || entry.contentBoxSize[0].blockSize * this.dpr;
            const canvas = entry.target;
            canvas.width = this.width = Math.max(1, Math.min(width, this.gpu.device.limits.maxTextureDimension2D));
            canvas.height = this.height = Math.max(1, Math.min(height, this.gpu.device.limits.maxTextureDimension2D));

            this.depth && this.createDepthTexture();
        }
        // Fire after width/height land so subscribers (e.g. camera aspect) see
        // the real backing size, not the canvas default. This is the first
        // honest size — no setTimeout race.
        for (const cb of this.resizeHandlers) cb(this.width, this.height);
    };

    // Fired whenever the canvas backing store resizes (including the first
    // ResizeObserver callback after boot). Receives (width, height). Returns
    // an unsubscribe fn.
    addResizeHandler(cb) {
        this.resizeHandlers.add(cb);
        return () => this.resizeHandlers.delete(cb);
    }

    handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            this.pause();
        } else {
            this.resume();
        }
    };

    add(f) {
        this.callBacks.add(f);
    }

    remove(f) {
        this.callBacks.delete(f);
    }

    // Fired when the device is lost, before recovery starts. Returns an
    // unsubscribe fn.
    addDeviceLostHandler(cb) {
        this.deviceLostHandlers.add(cb);
        return () => this.deviceLostHandlers.delete(cb);
    }

    // Fired after a new device is acquired and the context reconfigured;
    // receives the fresh `gpu`. Rebuild pipelines/buffers/textures/bind groups
    // here. Returns an unsubscribe fn.
    addDeviceRestoredHandler(cb) {
        this.deviceRestoredHandlers.add(cb);
        return () => this.deviceRestoredHandlers.delete(cb);
    }

    // Boot progress, 0–100 (monotonic). Returns an unsubscribe fn.
    addBootProgressHandler(cb) {
        this.bootProgressHandlers.add(cb);
        return () => this.bootProgressHandlers.delete(cb);
    }

    // Fired once when boot finishes and the scene is ready to show. Returns an
    // unsubscribe fn.
    addBootCompleteHandler(cb) {
        this.bootCompleteHandlers.add(cb);
        return () => this.bootCompleteHandlers.delete(cb);
    }

    // Test hook: exercise the recovery path without a real GPU loss. WebGPU has
    // no API to synthetically lose a device (destroy() reports reason
    // 'destroyed', which we deliberately don't recover from), so this drives
    // _onDeviceLost with a non-destroyed reason to run re-acquire + _restore.
    // The old device stays alive and orphaned until GC — fine for a one-off test.
    forceDeviceLoss() {
        this._onDeviceLost({ reason: 'simulated', message: 'forced via forceDeviceLoss()' });
    }

    pause = () => {
        this.paused = true;
    };

    resume = () => {
        this.paused = false;
    };

    setClearColor({ r = 0, g = 0, b = 0, a = this.transparent ? 0 : 1 } = {}) {
        this.clearColor = { r, g, b, a };
    }

    // Register an async setup promise (IBL bake, KTX/gltf fetch, etc.) for the
    // boot overlay to wait on before it fades. Optional — with nothing tracked
    // the overlay just holds its minimum visible window then fades.
    trackCompile(promise) {
        if (!promise) return;
        this._bootPromises.push(promise);
        promise.finally(() => {
            this._bootSettled = (this._bootSettled || 0) + 1;
            this._setProgress((this._bootSettled / this._bootPromises.length) * 100);
        });
    }

    // Emit boot progress to subscribers. Monotonic — never steps back when
    // promises are registered late and grow the total.
    _setProgress(pct) {
        const p = Math.max(this._bootProgress || 0, Math.min(100, pct));
        this._bootProgress = p;
        this.bootProgressHandlers.forEach((cb) => cb?.(p));
    }

    // Signals boot completion once the scene is ready to show. Called once, on
    // first render. Waits for any tracked setup promises to settle, debounces to
    // catch promises registered late during setup, then paints two frames before
    // completing. A hard timeout guarantees it never sticks.
    async _startBoot() {
        if (this._bootStarted) return;
        this._bootStarted = true;

        // Minimum on-screen time so a fast boot doesn't flash the loader for
        // one frame and vanish — reads as a glitch. Held from first render.
        const MIN_VISIBLE_MS = 350;
        const bootStart = performance.now();

        const hardStop = setTimeout(() => this._completeBoot(), 8000);

        // Settle current compiles, then re-check: building the scene can keep
        // adding pipelines for a few frames. Loop until the count is stable.
        let prev = -1;
        while (this._bootPromises.length !== prev) {
            prev = this._bootPromises.length;
            await Promise.allSettled(this._bootPromises);
            await new Promise((r) => requestAnimationFrame(r));
        }

        // Two painted frames so the first real (compiled) frames are on screen
        // before the overlay fades.
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));

        // Hold out the remainder of the minimum visible window, if any.
        const remaining = MIN_VISIBLE_MS - (performance.now() - bootStart);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

        clearTimeout(hardStop);
        this._setProgress(100);
        this._completeBoot();
    }

    _completeBoot() {
        if (this._bootComplete) return;
        this._bootComplete = true;
        this.bootCompleteHandlers.forEach((cb) => cb?.());
    }

    updateClock(time = 0) {
        // Guard the first frame: prevTime starts at 0, so without this the first
        // deltaTime would be the whole elapsed timestamp (a huge spike).
        this.deltaTime = this.prevTime ? (time - this.prevTime) / 1000 : 0;
        this.prevTime = time;
        this.time += this.deltaTime;
    }

    sortOpaque(a, b) {
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder;
        } else if (a.pipeline.id !== b.pipeline.id) {
            return a.pipeline.id - b.pipeline.id;
        } else if (a.zDepth !== b.zDepth) {
            return a.zDepth - b.zDepth;
        } else {
            return b.id - a.id;
        }
    }

    sortTransparent(a, b) {
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder;
        }
        if (a.zDepth !== b.zDepth) {
            return b.zDepth - a.zDepth;
        } else {
            return b.id - a.id;
        }
    }

    sortUI(a, b) {
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder;
        } else if (a.pipeline.id !== b.pipeline.id) {
            return a.pipeline.id - b.pipeline.id;
        } else {
            return b.id - a.id;
        }
    }

    // Build the frame draw list: skip invisible/manual/non-drawable, frustum-cull,
    // then split into opaque/transparent/UI buckets and sort each (UI = depthTest off).
    getRenderQueue({ scene, camera, sort = true, frustumCull = true } = {}) {
        this.renderQueue = [];

        const cull = frustumCull && !!camera;
        if (cull) camera.updateFrustum();

        scene.traverse((node) => {
            if (!node.visible) return true;
            if (node.manualRender) return;
            if (!node.draw) return;
            if (cull && node.frustumCulled && !camera.frustumIntersectsMesh(node)) return;

            this.renderQueue.push(node);
        });

        if (sort) {
            const opaque = [];
            const transparent = []; // depthTest true
            const ui = []; // depthTest false

            this.renderQueue.forEach((node) => {
                if (!node.pipeline.transparent) {
                    opaque.push(node);
                } else if (node.pipeline.depthTest) {
                    transparent.push(node);
                } else {
                    ui.push(node);
                }

                node.zDepth = 0;

                // Only calculate z-depth if renderOrder unset and depthTest is true
                if (node.renderOrder !== 0 || !node.pipeline.depthTest || !camera) return;

                node.worldMatrix.getTranslation(tempVec3);
                tempVec3.applyMat4(camera.projectionViewMatrix);
                node.zDepth = tempVec3[2];
            });

            opaque.sort(this.sortOpaque);
            transparent.sort(this.sortTransparent);
            ui.sort(this.sortUI);

            this.renderQueue = opaque.concat(transparent, ui);
        }

        return this.renderQueue;
    }

    // Draw scene from camera into `target` (RenderTarget/MRT) or the swapchain.
    // Pass an external `encoder` to chain into a larger submit — then render does
    // NOT finish/submit; the caller owns that. updateMatrices:false skips the walk.
    render({
        scene,
        camera,
        target = null,
        loadOp = 'clear',
        storeOp = 'store',
        depthLoadOp = 'clear',
        depthStoreOp = 'store',
        timing = false,
        encoder = null,
        frustumCull = true,
        updateMatrices = true,
    } = {}) {
        if (!this.gpu?.device) {
            console.error('No device found');
            return;
        }

        if (!this.isReady) return;

        if (this.paused) return;

        if (this._debug && !encoder && target === null) timing = true;

        if (!this._bootStarted) this._startBoot();

        // Walk + refresh world matrices (each node still dirty-flag gated, and a
        // node can opt out per-frame via matrixAutoUpdate). Pass
        // updateMatrices: false to skip the walk entirely for a static scene or
        // when you've already posed it yourself this frame.
        if (updateMatrices) {
            camera?.updateMatrixWorld?.();
            scene?.updateMatrixWorld?.();
        }

        let renderPassDescriptor;
        if (target) {
            let colorAttachments = [];
            target.textures.forEach((texture, i) => {
                if (texture.isDestroyed) return;
                let colorAttachment = {
                    view: target.msaaTextures.length > 0 ? target.msaaTextures[i].texture?.createView?.() : texture?.texture?.createView?.(),
                    clearValue: texture?.clearValue || (i === 0 ? this.clearColor : { r: 0, g: 0, b: 0, a: 0 }),
                    loadOp,
                    storeOp,
                };
                if (target.msaaTextures.length > 0) {
                    Object.assign(colorAttachment, {
                        resolveTarget: texture?.texture?.createView?.(),
                    });
                }
                colorAttachments.push(colorAttachment);
            });

            if (!target.depthTexture) {
                renderPassDescriptor = {
                    colorAttachments,
                };
            } else {
                renderPassDescriptor = {
                    colorAttachments,
                    depthStencilAttachment: {
                        view: target?.depthTexture?.createView?.(),
                        depthClearValue: 1.0,
                        depthLoadOp,
                        depthStoreOp,
                    },
                };
            }
        } else {
            if (!this.depthTexture || this.depthTexture.width !== this.width || this.depthTexture.height !== this.height) {
                this.depth && !this.depthTexture && this.createDepthTexture();
            }

            renderPassDescriptor = {
                colorAttachments: [
                    {
                        view: this?.gpu?.getCurrentTexture()?.createView?.(),
                        clearValue: this.clearColor,
                        loadOp,
                        storeOp,
                    },
                ],
                depthStencilAttachment: {
                    view: this?.depthTexture?.createView?.(),
                    depthClearValue: 1.0,
                    depthLoadOp,
                    depthStoreOp,
                },
            };
        }

        let _encoder = encoder || this.gpu.device.createCommandEncoder({ label: 'renderer-encoder' });
        let pass;

        if (timing) {
            pass = this.timingHelper.beginRenderPass(_encoder, renderPassDescriptor);
        } else {
            pass = _encoder.beginRenderPass(renderPassDescriptor);
        }

        this.getRenderQueue({ scene, camera, frustumCull });

        this.renderQueue?.forEach?.((node) => {
            node.draw({ camera, pass, time: this.time });
        });

        pass.end();

        if (!encoder) {
            const commandBuffer = _encoder.finish();
            this.gpu.device.queue.submit([commandBuffer]);

            if (timing) {
                this.timingHelper
                    .getResult()
                    .then((gpuTime) => {
                        this.gpuAverage.addSample(gpuTime / 1000);
                        this._gpuMs = gpuTime / 1e6;
                    })
                    .catch(() => {});
            }
        }
    }

    update = (time) => {
        // Loop owner. Bail (and relinquish ownership) the moment the device is
        // gone or not ready — _onDeviceLost flips isReady, which stops this loop
        // here; _restore/_startLoop starts a fresh one. No console spam: a lost
        // device during recovery is expected, not an error.
        if (!this.isReady || !this.gpu?.device) {
            this._loopRunning = false;
            return;
        }

        this._rafHandle = requestAnimationFrame(this.update);
        this.updateClock(time);
        this.callBacks.forEach((cb) => cb && cb({ time: this.time, deltaTime: this.deltaTime }));
    };
}
