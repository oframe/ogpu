import { Vec3 } from '@math';
import { TimingHelper } from '@utils/TimingHelper';
import { NonNegativeRollingAverage } from '@utils/miscutils';
import { getPromise } from '@utils/utils';
import { PerDrawBuffer, CAMERA_SIZE, OBJECT_SIZE, TIME_SIZE, TIME_BINDING_SIZE } from './PerDrawBuffer.js';
import { PipelineCache } from './PipelineCache.js';
import { BoundState, bindPassGroups } from './Mesh.js';
import { TextureFormat, AlphaMode } from './GPUEnums.js';
import { FullscreenTriangle } from './primitives/FullscreenTriangle.js';
import { Quad } from './primitives/Quad.js';

const _scissor = { x: 0, y: 0, width: 0, height: 0 }; // reused per draw, consumed immediately

const tempVec3 = /* @__PURE__ */ new Vec3(0, 0, 0);

export class Renderer {
    constructor({ canvas = null, dpr = null, transparent = false, depth = true, perDrawSize = 1 << 20 } = {}) {
        this.canvas = canvas;
        this.dpr = dpr || Math.min(2, devicePixelRatio);
        this.width = 2;
        this.height = 2;
        this.perDrawSize = perDrawSize;

        this.depth = depth;
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
        this.errorHandlers = new Set();
        // every context this renderer configured (extra canvases) — released in destroy()
        this._contexts = new Set();
        this.ready = getPromise();
        this._groups = []; // RenderBundleGroups met by the last getRenderQueue
        this._bundles = [];
        this._bundleRects = []; // resolved scissor per entry of _bundles
        this._oneBundle = [null];
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
            // On recovery (post-boot) `ready` already settled, so reject() here is
            // a no-op — the message is what actually reaches the console/user.
            const msg = this._initialized ? '[webgpu] device recovery failed — could not re-acquire an adapter/device; engine halted' : 'this browser does not support WebGPU';
            console.error(msg);
            this.ready.reject(new Error(msg));
            return;
        }

        const adapter = await navigator.gpu?.requestAdapter({
            powerPreference: 'high-performance',
        });
        if (!adapter) {
            const msg = this._initialized ? '[webgpu] device recovery failed — could not re-acquire an adapter/device; engine halted' : 'this browser supports webgpu but it appears disabled';
            console.error(msg);
            this.ready.reject(new Error(msg));
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
            // plural 'formats' — the GPUFeatureName enum is texture-formats-tierN.
            // Singular silently never matches, so tier1's r8unorm/r16float storage
            // (and tier2's read-write storage) stay unavailable.
            'texture-formats-tier1',
            'texture-formats-tier2',
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
        // Optional: without libktx_read.js on the page the engine still boots,
        // only KTX texture loading is unavailable.
        if (!window.ktx) {
            if (typeof window.createKtxReadModule === 'function') {
                window.ktx = await window.createKtxReadModule({
                    locateFile: (p) => (p.endsWith('.wasm') ? `${import.meta.env.BASE_URL}libktx_read.wasm` : p),
                });
            } else {
                console.warn('[webgpu] libktx_read.js not loaded — KTX textures unavailable');
            }
        }

        if (this._destroyed) {
            device.destroy();
            return;
        }

        // Surface uncaptured GPU validation/OOM errors to app code. Without
        // registered handlers the browser's own console report still fires (we
        // never preventDefault here — a handler can, via the event).
        device.addEventListener('uncapturederror', (e) => {
            this.errorHandlers.forEach((cb) => cb?.(e.error, e));
        });

        this.gpuAverage ??= new NonNegativeRollingAverage();
        this.timingHelper = new TimingHelper(device); // bound to the device, remake each time

        // device.lost resolves once, for the first loss of THIS device, so it's
        // freshly armed for every device we acquire. reason 'destroyed' means a
        // deliberate teardown — don't fight it.
        device.lost.then((info) => {
            // A superseded device (recovery already swapped in a newer one)
            // reporting its own loss later isn't a real loss to react to.
            if (this.gpu?.device && this.gpu.device !== device) return;
            this._onDeviceLost(info);
        });

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
            this._ownsCanvas = true;
        }

        this._configureContext(device);

        this._createEngineResources();

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
        const alphaMode = this.transparent ? AlphaMode.PREMULTIPLIED : AlphaMode.OPAQUE;
        this.gpu.configure({
            device,
            format: this.presentationFormat,
            alphaMode,
        });

        this.gpu.presentationFormat = this.presentationFormat;
        this.gpu.alphaMode = alphaMode;

        // Shared fullscreen geometries for blit / fullscreen passes. TRIANGLE is
        // the default (oversized single triangle, seamless, cheapest); QUAD is for
        // passes needing exact 4-corner interpolation (e.g. frustum-ray depth->world
        // reconstruction). Recreated here so device-loss recovery rebinds them.
        this.gpu.TRIANGLE = new FullscreenTriangle(this.gpu);
        this.gpu.QUAD = new Quad(this.gpu);
    }

    // device.lost handler. Drops isReady so the render loop bails before it
    // reschedules (see update()), notifies app code, then re-acquires a device
    // unless the loss was a deliberate destroy().
    _onDeviceLost(info) {
        if (this._destroyed) return;
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
        this._depthView = null;
        this.depth && this.createDepthTexture();

        // Same story: the old PerDrawBuffer's GPUBuffer died with the device.
        // Drop the reference (no destroy — same rationale as depth texture
        // above) and remake it, the engine groups (1 and 3) and the pipeline
        // cache against the fresh gpu. App code rebuilds its Shaders in deviceRestoredHandlers.
        this._createEngineResources();

        this.isReady = true;
        this._deviceLost = false;

        this.deviceRestoredHandlers.forEach((cb) => cb?.(this.gpu));

        this._startLoop();
        console.log('[webgpu] device restored');
    }

    // group(1) bind group over the PerDrawBuffer; remade when the buffer grows
    get engineBindGroup() {
        const pd = this.perDraw;
        if (!pd) return null;
        if (this._engineGeneration !== pd.generation) {
            this._engineGeneration = pd.generation;
            this._engineBindGroup = this.gpu.device.createBindGroup({
                label: 'engine-bind-group',
                layout: this.engineLayout,
                entries: [
                    { binding: 0, resource: { buffer: pd.buffer, size: CAMERA_SIZE } },
                    { binding: 1, resource: { buffer: pd.buffer, size: OBJECT_SIZE } },
                ],
            });
        }
        return this._engineBindGroup;
    }

    // group(3) bind group over the PerDrawBuffer's time slot; remade when the buffer grows
    get timeBindGroup() {
        const pd = this.perDraw;
        if (!pd) return null;
        if (this._timeGeneration !== pd.generation) {
            this._timeGeneration = pd.generation;
            this._timeBindGroup = this.gpu.device.createBindGroup({
                label: 'time-bind-group',
                layout: this.timeLayout,
                entries: [{ binding: 0, resource: { buffer: pd.buffer, offset: pd.timeOffset, size: TIME_BINDING_SIZE } }],
            });
        }
        return this._timeBindGroup;
    }

    // Engine-owned GPU state for Mesh draws: the PerDrawBuffer, the fixed group(1)
    // layout over it (camera slot at binding 0, object slot at binding 1, both
    // dynamic; the bind group is the engineBindGroup getter), the group(3) layout
    // over its time slot (bind group: the timeBindGroup getter, set once per
    // pass), the shared empty group, and the pipeline cache. Runs on boot and on every
    // device restore.
    _createEngineResources() {
        const { device } = this.gpu;
        this.perDraw = new PerDrawBuffer(this.gpu, { size: this.perDrawSize });

        const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        this.engineLayout = device.createBindGroupLayout({
            label: 'engine-layout',
            entries: [
                { binding: 0, visibility, buffer: { hasDynamicOffset: true, minBindingSize: CAMERA_SIZE } },
                { binding: 1, visibility, buffer: { hasDynamicOffset: true, minBindingSize: OBJECT_SIZE } },
            ],
        });
        this.timeLayout = device.createBindGroupLayout({
            label: 'time-layout',
            entries: [{ binding: 0, visibility, buffer: { minBindingSize: TIME_SIZE } }],
        });
        this._engineBindGroup = this._timeBindGroup = null;
        this._engineGeneration = this._timeGeneration = -1;

        this.emptyLayout = device.createBindGroupLayout({ label: 'empty-layout', entries: [] });
        this.emptyBindGroup = device.createBindGroup({ label: 'empty-bind-group', layout: this.emptyLayout, entries: [] });

        // one cache for the renderer's life; clear() invalidates every mesh memo
        if (this.pipelines) {
            this.pipelines.gpu = this.gpu;
            this.pipelines.clear();
        } else {
            this.pipelines = new PipelineCache(this.gpu);
        }
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
            format: TextureFormat.DEPTH24PLUS,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this._depthView = null;
    }

    addHandlers() {
        this._resizeObserver = new ResizeObserver(this.handleResize);
        try {
            this._resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
        } catch {
            this._resizeObserver.observe(this.canvas, { box: 'content-box' });
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

    // Fired for every uncaptured GPU error on the current device; receives
    // (error, event). event.preventDefault() suppresses the browser's own
    // console report. Returns an unsubscribe fn.
    addErrorHandler(cb) {
        this.errorHandlers.add(cb);
        return () => this.errorHandlers.delete(cb);
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

    // Full teardown (SPA route change): stops the loop, removes the resize
    // observer and document listener, destroys engine-owned GPU state and the
    // device, and releases every canvas context this renderer configured. The
    // renderer is dead afterwards — make a new one to render again.
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        this.isReady = false;
        this._loopRunning = false;
        if (this._rafHandle) cancelAnimationFrame(this._rafHandle);

        this._resizeObserver?.disconnect();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);

        this.callBacks.clear();
        this.deviceLostHandlers.clear();
        this.deviceRestoredHandlers.clear();
        this.resizeHandlers.clear();
        this.errorHandlers.clear();
        this.bootProgressHandlers.clear();
        this.bootCompleteHandlers.clear();

        // extra canvases: parked depth textures + their context configuration
        this._contexts.forEach((context) => {
            context.depthTexture?.destroy();
            context.depthTexture = context.depthView = null;
            context.unconfigure?.();
        });
        this._contexts.clear();

        this.depthTexture?.destroy();
        this.depthTexture = this._depthView = null;
        this.perDraw?.destroy();
        this.perDraw = null;
        this._timeBindGroup = null;
        this.pipelines?.clear();
        this._engineBindGroup = this.emptyBindGroup = null;
        this._groups.length = this._bundles.length = 0;

        // reason 'destroyed' — _onDeviceLost deliberately doesn't recover from
        // it, and the _destroyed guard above silences the loss report
        this.gpu?.device?.destroy();
        this.gpu?.unconfigure?.();
        this.gpu = null;

        if (this._ownsCanvas) this.canvas.remove();
    }

    pause = () => {
        this.paused = true;
    };

    resume = () => {
        // Reset so updateClock's prevTime===0 guard eats this frame's delta
        // instead of reporting the entire hidden/paused duration as a spike.
        this.prevTime = 0;
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

    // Array.prototype.sort is stable, so ties keep scene-traversal order.
    sortOpaque(a, b) {
        if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
        if (a._sortId !== b._sortId) return a._sortId - b._sortId;
        return a.zDepth - b.zDepth;
    }

    sortTransparent(a, b) {
        if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
        return b.zDepth - a.zDepth;
    }

    sortUI(a, b) {
        if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
        return a._sortId - b._sortId;
    }

    // Build the frame draw list: skip invisible/manual/non-drawable, frustum-cull,
    // then split into opaque/transparent/UI buckets and sort each (UI = depthTest off).
    getRenderQueue({ scene, camera, sort = true, frustumCull = true } = {}) {
        this.renderQueue = [];

        const cull = frustumCull && !!camera;
        if (cull) camera.updateFrustum();

        const groups = this._groups;
        groups.length = 0;

        scene.traverse((node) => {
            if (!node.visible) return true;
            // drawn from its bundle; its subtree never enters the live queue
            if (node.isRenderBundleGroup) {
                groups.push(node);
                return true;
            }
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
                const state = node.state;
                const depthTest = state.depthTest !== false;
                node._sortId = node.shader.id;
                if (!state.transparent) {
                    opaque.push(node);
                } else if (depthTest) {
                    transparent.push(node);
                } else {
                    ui.push(node);
                }

                node.zDepth = 0;

                // z-depth for depth-aware sorting: opaque tiebreak, transparent
                // far-to-near WITHIN each renderOrder group — so it's computed
                // regardless of renderOrder (only UI/depthTest-off skips it)
                if (!depthTest || !camera) return;

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

    // Point the NEXT render() at another canvas. The binding lasts exactly one
    // render() — render() hands the default canvas back on its way out; pass
    // null to restore immediately. Every extra canvas keeps its own context and
    // depth texture, made on first use. Set its width/height yourself: the
    // renderer only observes its own canvas. Per-draw uniforms come from the
    // shared PerDrawBuffer, so drawing one scene into N canvases per frame
    // needs no per-canvas buffers. Only Renderer.render follows the binding —
    // fullscreen VFX passes draw into whatever `gpu` they were built with.
    // `options` ({transparent, format}) configures THIS canvas — see contextFor.
    setContext(canvas = null, options) {
        // pre-ready or destroyed: nothing bound yet, nothing to restore
        if (!this.gpu) return;
        const target = canvas || this.canvas;
        if (target === this.gpu.canvas) return;

        // park the live depth texture on the context it was sized for
        this.gpu.depthTexture = this.depthTexture;
        this.gpu.depthView = this._depthView;

        const context = this.contextFor(target, options);
        this.gpu = context;
        this.depthTexture = context.depthTexture ?? null;
        this._depthView = context.depthView ?? null;
    }

    // The configured, augmented WebGPU context for any canvas — hand a pass
    // `contextFor(c).getCurrentTexture().createView()` as its `target` to land
    // output on `c` instead of the default canvas. getContext('webgpu') returns
    // the same object for a given canvas, so the context doubles as the
    // per-canvas record — configured once, and again after a device loss (by
    // then its `device` is the dead one, and its depth texture died with it).
    //
    // `options` configures THIS canvas independently of the renderer defaults:
    //   transparent — premultiplied vs opaque compositing for this canvas
    //   format      — swapchain format; pipelines drawn into it must target it
    //                 (`targets: [{format}]`), the engine default targets
    //                 `presentationFormat`
    // Omitted options keep whatever the canvas was last configured with (so a
    // device-loss reconfigure preserves per-canvas choices), falling back to
    // the renderer-level `transparent`/preferred-format defaults.
    contextFor(canvas, { transparent, format } = {}) {
        const context = canvas.getContext('webgpu');

        const _format = format ?? context.presentationFormat ?? this.presentationFormat;
        const _alphaMode =
            transparent === undefined ? (context.alphaMode ?? (this.transparent ? AlphaMode.PREMULTIPLIED : AlphaMode.OPAQUE)) : transparent ? AlphaMode.PREMULTIPLIED : AlphaMode.OPAQUE;

        const deviceStale = context.device !== this.gpu.device;
        if (!deviceStale && context.presentationFormat === _format && context.alphaMode === _alphaMode) return context;

        context.configure({
            device: this.gpu.device,
            format: _format,
            alphaMode: _alphaMode,
        });

        Object.assign(context, {
            device: this.gpu.device,
            renderer: this,
            presentationFormat: _format,
            alphaMode: _alphaMode,
            TRIANGLE: this.gpu.TRIANGLE,
            QUAD: this.gpu.QUAD,
            // depth died with a lost device; a same-device format/alpha
            // reconfigure keeps it (depth format is independent of color)
            depthTexture: deviceStale ? null : (context.depthTexture ?? null),
            depthView: deviceStale ? null : (context.depthView ?? null),
        });

        this._contexts.add(context);

        return context;
    }

    // Attachments for a RenderTarget/MRT draw: one color attachment per target
    // texture — with MSAA the multisampled texture is the view and the plain one
    // is the resolve target. Depth only if the target owns a depth texture.
    _targetPassDescriptor(target, { loadOp, storeOp, depthLoadOp, depthStoreOp }) {
        const msaa = target.msaaTextures.length > 0;

        const colorAttachments = [];
        target.textures.forEach((texture, i) => {
            if (texture.isDestroyed) return;
            colorAttachments.push({
                view: msaa ? target.msaaTextures[i]?.createView?.() : texture?.createView?.(),
                ...(msaa && { resolveTarget: texture?.createView?.() }),
                clearValue: texture?.clearValue || (i === 0 ? this.clearColor : { r: 0, g: 0, b: 0, a: 0 }),
                loadOp,
                storeOp,
            });
        });

        if (!target.depthTexture) return { colorAttachments };

        return {
            colorAttachments,
            depthStencilAttachment: {
                view: target?.depthView?.(),
                depthClearValue: 1.0,
                depthLoadOp,
                depthStoreOp,
            },
        };
    }

    // Attachments for a direct draw into the currently bound canvas, with the
    // engine-owned depth texture.
    _canvasPassDescriptor({ loadOp, storeOp, depthLoadOp, depthStoreOp }) {
        // size against the BOUND canvas, not this.width/height — those track the
        // default canvas only (see setContext).
        const { width, height } = this.gpu.canvas;
        if (this.depth && (!this.depthTexture || this.depthTexture.width !== width || this.depthTexture.height !== height)) {
            this.createDepthTexture();
        }

        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: this?.gpu?.getCurrentTexture()?.createView?.(),
                    clearValue: this.clearColor,
                    loadOp,
                    storeOp,
                },
            ],
        };

        // Without this.depthTexture (depth: false) there's nothing to attach —
        // an attachment with an undefined view fails validation.
        if (this.depthTexture) {
            this._depthView ??= this.depthTexture.createView();
            renderPassDescriptor.depthStencilAttachment = {
                view: this._depthView,
                depthClearValue: 1.0,
                depthLoadOp,
                depthStoreOp,
            };
        }

        return renderPassDescriptor;
    }

    // Bundles of the RenderBundleGroups the queue walk met: refresh their children's
    // slots (only moved ones write), encode per pass kind on first use. A group
    // never recorded is skipped (warned once); a stale one still replays.
    _recordedBundles(passInfo, cameraOffset, width, height) {
        const bundles = this._bundles;
        const rects = this._bundleRects;
        bundles.length = 0;
        const groups = this._groups;
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            // a bundle can't set the scissor: it replays under the group's own
            // resolved rect, and a group clipped to nothing is skipped
            const r = (rects[bundles.length] ??= { x: 0, y: 0, width: 0, height: 0 });
            if (!this.resolveScissor(group, width, height, r)) continue;
            if (!group.recorded) {
                if (!group._unrecordedWarned) {
                    group._unrecordedWarned = true;
                    console.warn(`[renderer] RenderBundleGroup '${group.label}' was never recorded — call record(); its children are not drawn`);
                }
                continue;
            }
            group._writeSlots(this.perDraw);
            // stale is O(descendants): sampled, it only feeds a warning
            if (!group._staleWarned && (group._staleTick = (group._staleTick + 1) % 30) === 0) {
                if (group.stale) {
                    group._staleWarned = true;
                    console.warn(`[renderer] RenderBundleGroup '${group.label}' is stale (children changed since record()) — replaying the old recording; call record()`);
                }
            }
            bundles.push(group._bundleFor(this, passInfo, cameraOffset));
        }
        return bundles;
    }

    // Formats + sample count of the pass a render() opens — the pipeline cache
    // keys on these, so a mesh drawn into a target, an MSAA target or the canvas
    // gets a matching pipeline. Mirrors _targetPassDescriptor / _canvasPassDescriptor.
    _targetPassInfo(target) {
        const formats = [];
        target.textures.forEach((texture) => {
            if (!texture.isDestroyed) formats.push(texture.format);
        });
        return this.pipelines.passInfo(formats, target.depthTexture ? target.depthTexture.format : null, target.sampleCount ?? 1);
    }

    // The canvas currently bound (setContext swaps this.gpu and the depth texture
    // with it), so a second canvas with its own format gets its own pipelines.
    // Depth follows what _canvasPassDescriptor attached; compile() runs before the
    // depth texture exists and passes the format it will have.
    _canvasPassInfo(depthFormat = this.depthTexture?.format ?? null) {
        return this.pipelines.passInfo([this.gpu.presentationFormat], depthFormat, 1);
    }

    // Warm-up: compile every Mesh pipeline `scene` needs for `target` (or the
    // canvas) with createRenderPipelineAsync, so the first draw doesn't stall.
    // Optional — without it, pipelines compile synchronously on first draw.
    compile({ scene, target = null } = {}) {
        if (!this.isReady) return Promise.resolve();
        const passInfo = target ? this._targetPassInfo(target) : this._canvasPassInfo(this.depth ? TextureFormat.DEPTH24PLUS : null);
        const pending = [];
        scene.traverse((node) => {
            if (node.shader && node.geometry) {
                pending.push(this.pipelines.compileAsync(node, passInfo));
            }
        });
        return Promise.all(pending).then(() => {});
    }

    // Draw scene from camera into `target` (RenderTarget/MRT) or the canvas bound
    // by setContext (the default one unless you bound another). Pass an external
    // `encoder` to chain into a larger submit — then render does NOT
    // finish/submit; the caller owns that. updateMatrices:false skips the walk.
    // The try/finally is the setContext contract: a bound canvas lasts exactly
    // one render, including the early-return paths below.
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
        try {
            if (!this.gpu?.device) {
                console.error('No device found');
                return;
            }

            if (!this.isReady) return;

            if (this.paused) return;

            if (this._debug && !encoder && target === null) timing = true;

            // getResult() only runs on the renderer-owned submit path below, so a
            // timed pass on an external encoder would leave the helper stuck
            // waiting and wedge the next timed pass.
            if (encoder) timing = false;

            if (!this._bootStarted) this._startBoot();

            // Walk + refresh world matrices (a node recomposes only when its TRS changed, and
            // can opt out per-frame via matrixAutoUpdate). Pass
            // updateMatrices: false to skip the walk entirely for a static scene or
            // when you've already posed it yourself this frame.
            if (updateMatrices) {
                camera?.updateMatrixWorld?.();
                scene?.updateMatrixWorld?.();
            }

            const ops = { loadOp, storeOp, depthLoadOp, depthStoreOp };
            const renderPassDescriptor = target ? this._targetPassDescriptor(target, ops) : this._canvasPassDescriptor(ops);

            // after the descriptor: it may (re)create the bound canvas's depth texture
            const passInfo = target ? this._targetPassInfo(target) : this._canvasPassInfo();
            const width = target ? target.width : this.gpu.canvas.width;
            const height = target ? target.height : this.gpu.canvas.height;
            // the frame's next camera slot; every draw in the pass shares it
            const cameraOffset = this.perDraw.writeCamera(camera, width, height);
            this.perDraw.writeTime(this.time, this.deltaTime);

            // before the pass opens: slot acquisition may grow the engine buffer
            this.getRenderQueue({ scene, camera, frustumCull });
            const bundles = this._recordedBundles(passInfo, cameraOffset, width, height);

            const _encoder = encoder || this.gpu.device.createCommandEncoder({ label: 'renderer-encoder' });
            const pass = timing ? this.timingHelper.beginRenderPass(_encoder, renderPassDescriptor) : _encoder.beginRenderPass(renderPassDescriptor);

            // per render(): a callback may render() into another pass mid-loop
            const args = { camera, pass, passInfo, renderer: this, cameraOffset, bound: new BoundState() };
            // A pass starts with the full-attachment scissor, so a scene without
            // scissors never calls setScissorRect. Once one is set it is sticky pass
            // state; nodes without one resolve to the full rect, which resets it.
            let sx = 0, sy = 0, sw = width, sh = height; // prettier-ignore
            // render bundle groups replay first, ahead of every live draw, each under
            // its resolved scissor; when none is scissored they share one executeBundles
            let scissored = false;
            for (let i = 0; i < bundles.length; i++) {
                const r = this._bundleRects[i];
                if (r.x || r.y || r.width !== width || r.height !== height) scissored = true;
            }
            if (bundles.length && !scissored) pass.executeBundles(bundles);
            else if (bundles.length) {
                const one = this._oneBundle;
                for (let i = 0; i < bundles.length; i++) {
                    const r = this._bundleRects[i];
                    if (r.x !== sx || r.y !== sy || r.width !== sw || r.height !== sh) {
                        pass.setScissorRect(r.x, r.y, r.width, r.height);
                        sx = r.x;
                        sy = r.y;
                        sw = r.width;
                        sh = r.height;
                    }
                    one[0] = bundles[i];
                    pass.executeBundles(one);
                }
                one[0] = null;
            }
            // the live draws' pass start, after any executeBundles (which leaves the
            // pass with nothing bound): group(3) and the empty group 2 once, `bound`
            // seeded to match. The reset is a no-op while `bound` is fresh here; it
            // keeps this right if anything ever draws ahead of the bundles.
            if (bundles.length) args.bound.reset();
            if (this.renderQueue?.length) bindPassGroups(pass, this, args.bound);
            for (const node of this.renderQueue ?? []) {
                const rect = this.resolveScissor(node, width, height, _scissor);
                if (!rect) continue; // clipped to nothing: skip the draw
                if (rect.x !== sx || rect.y !== sy || rect.width !== sw || rect.height !== sh) {
                    pass.setScissorRect(rect.x, rect.y, rect.width, rect.height);
                    sx = rect.x;
                    sy = rect.y;
                    sw = rect.width;
                    sh = rect.height;
                }
                node.draw(args);
            }

            pass.end();

            // upload the slots written since the last flush — queued before
            // whichever submit carries the pass (ours below, or the caller's)
            this.perDraw.flush();

            if (encoder) return; // caller owns finish/submit

            this.gpu.device.queue.submit([_encoder.finish()]);
            this.perDraw.epoch++; // queue order makes later rewrites safe

            if (timing) {
                this.timingHelper
                    .getResult()
                    .then((gpuTime) => {
                        this.gpuAverage.addSample(gpuTime / 1000);
                        this._gpuMs = gpuTime / 1e6;
                    })
                    .catch(() => {});
            }
        } finally {
            this.setContext(null);
        }
    }

    // Intersection of `node.scissor` and every ancestor's, clamped to the target
    // (attachment pixels, origin top-left). Returns `out` (default: a new object)
    // filled with { x, y, width, height }, or null when the result is empty.
    // A scissor with a non-finite field is ignored, with a one-time warning.
    resolveScissor(node, targetWidth, targetHeight, out = {}) {
        let x0 = 0;
        let y0 = 0;
        let x1 = targetWidth;
        let y1 = targetHeight;

        for (let n = node; n; n = n.parent) {
            const s = n.scissor;
            if (!s) continue;
            if (!(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.width) && Number.isFinite(s.height))) {
                if (!this._badScissorWarned) {
                    this._badScissorWarned = true;
                    console.warn('[renderer] ignoring a scissor with a non-finite field', s);
                }
                continue;
            }
            x0 = Math.max(x0, Math.round(s.x));
            y0 = Math.max(y0, Math.round(s.y));
            x1 = Math.min(x1, Math.round(s.x + s.width));
            y1 = Math.min(y1, Math.round(s.y + s.height));
        }

        if (x1 <= x0 || y1 <= y0) return null;
        out.x = x0;
        out.y = y0;
        out.width = x1 - x0;
        out.height = y1 - y0;
        return out;
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
        if (this.paused) return;

        // One frame boundary per rendered frame: camera slots restart (each
        // render() in the frame takes the next one). Unflushed slots mean a Mesh
        // drew outside render(): its uniforms never reached the GPU.
        const pd = this.perDraw;
        if (pd?.pending && !this._unflushedWarned) {
            this._unflushedWarned = true;
            console.warn('[renderer] mesh.draw() outside render() — call renderer.perDraw.flush() before submitting');
        }
        this.perDraw?.reset();

        this.updateClock(time);
        this.callBacks.forEach((cb) => cb && cb({ time: this.time, deltaTime: this.deltaTime }));
    };
}
