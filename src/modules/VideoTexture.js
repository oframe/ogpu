/**
 * VideoTexture — a GPUTexture that streams live frames from an HTMLVideoElement.
 *
 * Uploads each decoded frame via `device.queue.copyExternalImageToTexture`, which
 * is the lowest-overhead path for video sources: it hands the frame directly to
 * the driver without an intermediate CPU copy, and accepts HTMLVideoElement natively.
 *
 * Frame scheduling: uses `video.requestVideoFrameCallback` (rVFC) when available
 * so uploads are perfectly synchronised with new decoded frames (no redundant
 * re-uploads on a faster rAF loop). Falls back to `requestAnimationFrame` on
 * browsers that lack rVFC (older mobile Safari, some Android WebViews).
 * The two APIs have different cancel calls — `cancelVideoFrameCallback` vs
 * `cancelAnimationFrame` — so we track which one is in use.
 *
 * Usage:
 *   const vt = new VideoTexture(gpu, { video: './myvideo.mp4' });
 *   // bind vt.createView() into your mesh's bind group (see Mesh `bindGroups` factory)
 */

let TEXTURE_ID = 1;

const USE_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export class VideoTexture {
    constructor(gpu, { video, format = 'rgba8unorm', label = '', autoStart = true, flipY = false } = {}) {
        this.gpu = gpu;
        this.id = TEXTURE_ID++;
        this.label = `Texture ${this.id}: ${label}`;
        this.format = format;
        this.flipY = flipY;
        this.autoStart = autoStart;

        this.texture = null;
        this.isDestroyed = false;
        this._callbackHandle = null;
        this._useRVFC = USE_RVFC;
        this._running = false;
        this._metadataReady = false;

        // Width/height tracked to detect dimension changes at runtime.
        this._videoWidth = 0;
        this._videoHeight = 0;

        // Resolves with this instance once the texture exists (video metadata
        // loaded and sized). Lets consumers `await vt.ready` / `vt.ready.then(...)`
        // before building a bind group, instead of polling for `vt.texture` in
        // their render loop. Mirrors `renderer.ready`.
        this.ready = new Promise((resolve) => {
            this._resolveReady = resolve;
        });

        this._onMetadata = this._onMetadata.bind(this);
        this._onEnded = this._onEnded.bind(this);
        this._tick = this._tick.bind(this);

        if (typeof video === 'string') {
            this._ownedVideo = true;
            this.video = document.createElement('video');
            this.video.muted = true;
            this.video.playsInline = true;
            this.video.loop = true;
            this.video.crossOrigin = 'anonymous';
            this.video.src = video;
            // iOS ignores loop on inline muted video — fires `ended` and stops,
            // freezing the rVFC chain. Loop manually as fallback.
            this.video.addEventListener('ended', this._onEnded);
        } else {
            this._ownedVideo = false;
            this.video = video;
        }

        // If the video is already sized (e.g. pre-loaded element passed in), skip the wait.
        if (this.video.readyState >= 1 && this.video.videoWidth > 0) {
            this._metadataReady = true;
            this._ensureTexture();
            if (this.autoStart) this.start();
        } else {
            this.video.addEventListener('loadedmetadata', this._onMetadata, { once: true });
        }
    }

    // -------------------------------------------------------------------------
    // Internal

    _onMetadata() {
        if (this.isDestroyed) return;
        this._metadataReady = true;
        this._ensureTexture();
        // If start() was already called (manually or via autoStart) before the
        // texture existed, it set _running but couldn't schedule — do it now.
        // Otherwise honor autoStart.
        if (this._running) this._schedule();
        else if (this.autoStart) this.start();
    }

    // Manual loop fallback (iOS). Rewind + replay.
    _onEnded() {
        if (this.isDestroyed || !this._running) return;
        this.video.currentTime = 0;
        const p = this.video.play();
        if (p && p.catch) p.catch(() => {});
    }

    /**
     * Creates (or recreates) the GPUTexture to match the current video dimensions.
     * Called once on metadata load and again if the video dimensions change.
     */
    _ensureTexture() {
        const w = this.video.videoWidth;
        const h = this.video.videoHeight;

        if (w === 0 || h === 0) return;
        if (w === this._videoWidth && h === this._videoHeight && this.texture) return;

        // Destroy the previous texture before reallocating.
        if (this.texture) {
            this.texture.destroy();
            this.texture = null;
        }

        this._videoWidth = w;
        this._videoHeight = h;

        // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT is required by
        // copyExternalImageToTexture (the spec mandates RENDER_ATTACHMENT for
        // color-renderable formats when the destination is used as an import target).
        this.texture = this.gpu.device.createTexture({
            label: this.label,
            size: [w, h],
            format: this.format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Signal first availability. Resolves only once; a later resize swaps the
        // texture underneath (the old view is invalidated), so consumers that must
        // survive resolution changes should still refresh their bind group then.
        if (this._resolveReady) {
            this._resolveReady(this);
            this._resolveReady = null;
        }
    }

    /**
     * Per-frame callback — uploads the current video frame, then reschedules.
     */
    _tick() {
        if (this.isDestroyed || !this._running) return;

        this._upload();
        this._schedule();
    }

    _upload() {
        if (!this._metadataReady || !this.video || this.video.readyState < 2) return;

        // Recreate the texture if the video dimensions changed (e.g. adaptive stream).
        this._ensureTexture();
        if (!this.texture) return;

        // `copyExternalImageToTexture` is the direct, zero-copy path for video frames.
        // It accepts HTMLVideoElement as a source and internally calls
        // `importExternalTexture` at the driver level, avoiding a round-trip through
        // CPU memory. webgpu-utils' `copySourceToTexture` wraps this same call but
        // adds array handling we don't need here, so we call the native API directly.
        this.gpu.device.queue.copyExternalImageToTexture({ source: this.video, flipY: this.flipY }, { texture: this.texture }, [this._videoWidth, this._videoHeight]);
    }

    _schedule() {
        if (!this._running || this.isDestroyed) return;

        if (this._useRVFC) {
            this._callbackHandle = this.video.requestVideoFrameCallback(this._tick);
        } else {
            this._callbackHandle = requestAnimationFrame(this._tick);
        }
    }

    _cancelPending() {
        if (this._callbackHandle === null) return;

        if (this._useRVFC) {
            this.video.cancelVideoFrameCallback(this._callbackHandle);
        } else {
            cancelAnimationFrame(this._callbackHandle);
        }
        this._callbackHandle = null;
    }

    /**
     * Start uploading frames. Safe to call multiple times — no-ops if already running.
     * If the video metadata hasn't loaded yet the loop will start automatically once
     * it does (because `autoStart` defers to this method internally).
     */
    start() {
        if (this._running || this.isDestroyed) return;
        this._running = true;

        // We own the URL-created element, so we drive its playback. Without play()
        // the video never advances and no frames are ever produced. Externally
        // supplied elements are left under the caller's control.
        if (this._ownedVideo && this.video) {
            const p = this.video.play();
            if (p && p.catch) p.catch(() => {}); // autoplay can reject; muted+inline should be fine
        }

        // Only schedule if we already have a texture; otherwise _onMetadata will
        // schedule once the dimensions (and texture) are known.
        if (this.texture) {
            this._schedule();
        }
    }

    /**
     * Stop uploading frames and cancel the pending callback.
     */
    stop() {
        this._running = false;
        this._cancelPending();
        // Pause the element we own so it doesn't keep decoding in the background.
        if (this._ownedVideo && this.video) this.video.pause();
    }

    /**
     * Returns a GPUTextureView for binding to a render/compute pipeline.
     */
    createView() {
        if (!this.texture) return null;
        return this.texture.createView();
    }

    get width() {
        return this._videoWidth;
    }

    get height() {
        return this._videoHeight;
    }

    /**
     * Destroy the GPU texture and stop the update loop. After calling this the
     * instance must not be used again.
     */
    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        this.stop();

        if (this.texture) {
            this.texture.destroy();
            this.texture = null;
        }

        this.video.removeEventListener('loadedmetadata', this._onMetadata);
        this.video.removeEventListener('ended', this._onEnded);

        if (this._ownedVideo) {
            this.video.pause();
            this.video.src = '';
            this.video.load();
        }

        this.video = null;
    }
}
