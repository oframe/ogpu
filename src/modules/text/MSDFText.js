import { Mesh } from '@core/Mesh';
import { Geometry } from '@core/Geometry';
import { Shader } from '@core/Shader';
import { UniformBuffer } from '@core/UniformBuffer';
import { Vec3 } from '@math';

import { layoutText } from './layout.js';
import { TEXT_PRESETS } from './presets.js';
import textShader from './text.wgsl?raw';

const SPLIT = { chars: 0, words: 1, lines: 2 };
const MASK = { none: 0, chars: 1, words: 2, lines: 3 };
const ORDER = { start: 0, end: 1, center: 2, edges: 3, random: 4 };
const EASE = {
    none: 0,
    linear: 0,
    'power1.out': 1,
    'power2.out': 2,
    'power3.out': 3,
    'power4.out': 4,
    'expo.out': 5,
    'back.out': 6,
    'sine.out': 7,
    'circ.out': 8,
    'power3.inOut': 9,
    'expo.inOut': 10,
    'elastic.out': 11,
};
const WIPE = {
    'left-to-right': [1, 0],
    'right-to-left': [-1, 0],
    'bottom-to-top': [0, 1],
    'top-to-bottom': [0, -1],
};
const DEG = Math.PI / 180;

const QUAD = {
    position: { data: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), numComponents: 2 },
    indices: new Uint16Array([0, 1, 2, 2, 1, 3]),
};

// one Shader per device: the atlas is a bind group resource, and every MSDFText shares
// the vertex layout, so the pipeline cache hands them all one pipeline per pass kind
const shaders = new WeakMap();
function textShaderFor(gpu) {
    let shader = shaders.get(gpu.device);
    if (!shader) {
        shader = new Shader(gpu, { label: 'msdf-text', code: textShader });
        shaders.set(gpu.device, shader);
    }
    return shader;
}

// overlapping quads (kerning, the sdf margin) at one z would clip each other, and
// per-unit flips show back faces mid-tween
const DEPTH_TESTED = { transparent: true, depthWrite: false, depthTest: true, cullMode: 'none' };
const ALWAYS_ON_TOP = { ...DEPTH_TESTED, depthTest: false };

const rgba = (c) => (c.length === 3 ? [c[0], c[1], c[2], 1] : Array.from(c));

// An MSDF text block: one instanced quad per glyph, laid out on the CPU, revealed on
// the GPU. The reveal is a stagger over chars/words/lines (see presets.js); `progress`
// is scrubbable, play()/reverse() drive it off the renderer clock.
export class MSDFText extends Mesh {
    constructor(
        gpu,
        {
            font,
            text = '',
            size = 1,
            width = Infinity,
            lineHeight,
            letterSpacing = 0,
            align = 'left',
            anchorX = 'center',
            anchorY = 'middle',
            color = [1, 1, 1, 1],
            outline = 0,
            outlineColor = [0, 0, 0, 1],
            depthTest = true,
            wireframe = false,
            shader,
            label = 'text',
            renderOrder = 0,
        } = {}
    ) {
        if (!font) throw new Error(`[msdf-text ${label}] no font provided`);

        const options = { size, width, lineHeight, letterSpacing, align, anchorX, anchorY };
        const layout = layoutText(font, text, options);
        const geometry = MSDFText._geometry(gpu, layout);

        shader ??= textShaderFor(gpu);
        const uniforms = new UniformBuffer(gpu, shader.uniforms, null, {
            label: `${label}-uniforms`,
        });

        super({
            label,
            geometry,
            shader,
            state: depthTest ? DEPTH_TESTED : ALWAYS_ON_TOP,
            renderOrder,
            bindGroups: [shader.bindGroupLayout(0).createBindGroup({ uniforms, atlasSampler: font.sampler, tMap: font.texture.createView() }, { label: `${label}-bind-group` })],
        });

        this.gpu = gpu;
        this.uniforms = uniforms;
        this.font = font;
        this.text = String(text);
        this.layoutOptions = options;
        this.autoUpdate = true; // advance play()/reverse() from renderer.time at each draw

        this.time = 0;
        this.direction = 0;
        this.totalDuration = 0;
        this._lastClock = null;
        this._settle = null;

        this.uniforms.set({
            uColor: rgba(color),
            uOutlineColor: rgba(outlineColor),
            uOutline: outline,
            uPxRange: font.pxRange,
            uEmPx: font.emPx,
        });
        this.wireframe = wireframe;
        this._applyLayout(layout);
        this.animate({}); // identity "from" state: visible at any progress
    }

    static _geometry(gpu, layout) {
        const n = Math.max(layout.glyphs.length, 1); // keep the layout valid for empty text
        const attrs = ['rect', 'atlas', 'ids', 'charBox', 'wordBox', 'lineBox'];
        const data = Object.fromEntries(attrs.map((k) => [k, new Float32Array(n * 4)]));
        layout.glyphs.forEach((g, i) => {
            data.rect.set(g.rect, i * 4);
            data.atlas.set(g.uv, i * 4);
            data.ids.set([g.char, g.word, g.line, 0], i * 4);
            data.charBox.set(g.charBox, i * 4);
            data.wordBox.set(g.wordBox, i * 4);
            data.lineBox.set(g.lineBox, i * 4);
        });
        return new Geometry(gpu, {
            data: QUAD,
            instancedData: Object.fromEntries(attrs.map((k) => [k, { data: data[k], numComponents: 4 }])),
            interleave: true,
        });
    }

    _applyLayout(layout) {
        this.layout = layout;
        this.glyphCount = layout.glyphs.length;
        this.counts = layout.counts;
        this.uniforms.set({
            uCounts: [layout.counts.chars, layout.counts.words, layout.counts.lines],
            uEm: this.layoutOptions.size,
        });
    }

    // instanced, so the culler can't derive extents — hand it the layout box, padded by
    // how far the current "from" state can throw a glyph
    _updateBounds() {
        const [l, b, r, t] = this.layout.bounds;
        const reach = this._reach ?? 0;
        const min = new Vec3(l - reach, b - reach, -reach);
        const max = new Vec3(r + reach, t + reach, reach);
        const center = new Vec3().copy(min).add(max).scale(0.5);
        const scale = new Vec3().copy(max).sub(min);
        this.geometry.bounds = { min, max, center, scale, radius: scale.len() * 0.5 };
    }

    setText(text, options = {}) {
        this.text = String(text ?? '');
        Object.assign(this.layoutOptions, options);
        const layout = layoutText(this.font, this.text, this.layoutOptions);
        this.geometry.destroy();
        this.geometry = MSDFText._geometry(this.gpu, layout);

        // keep the playhead at the same fraction of the (re-spanned) timeline
        const progress = this.time < 0 ? null : this.progress;
        this._applyLayout(layout);
        this._span();
        this.seek(progress === null ? this.time : progress * this.totalDuration);
        return this;
    }

    set color(c) {
        this.uniforms.set({ uColor: rgba(c) });
    }

    // the glyph quads' edges (and the diagonal their triangles share) in place of the glyphs
    set wireframe(on) {
        this._wireframe = !!on;
        this.uniforms.set({ uWireframe: on ? 1 : 0 });
    }

    get wireframe() {
        return this._wireframe;
    }

    // Configure the reveal. `preset` is a TEXT_PRESETS name or an options object;
    // `overrides` merge over it (from: merges key by key). Resets to progress 0.
    animate(preset, overrides = {}) {
        const base = typeof preset === 'string' ? TEXT_PRESETS[preset] : preset;
        if (!base) throw new Error(`[msdf-text ${this.label}] unknown preset '${preset}'`);
        const o = { ...base, ...overrides, from: { ...base.from, ...overrides.from } };
        const {
            split = 'chars',
            mask = 'none',
            order = 'start',
            ease = 'power3.out',
            duration = 1,
            stagger = 0.03,
            delay = 0,
            origin = [0.5, 0.5],
            wipe = null,
            wipeSoftness = 0.1,
            seed = 1,
            from = {},
        } = o;

        for (const [name, table, value] of [
            ['split', SPLIT, split],
            ['mask', MASK, mask],
            ['order', ORDER, order],
            ['ease', EASE, ease],
        ]) {
            if (!(value in table)) throw new Error(`[msdf-text ${this.label}] unknown ${name} '${value}'`);
        }

        const em = this.layoutOptions.size;
        const scale = from.scale ?? 1;
        const offset = [(from.x ?? 0) * em, (from.y ?? 0) * em, (from.z ?? 0) * em];
        const rotation = [(from.rotationX ?? 0) * DEG, (from.rotationY ?? 0) * DEG, (from.rotation ?? from.rotationZ ?? 0) * DEG];
        this.uniforms.set({
            uStaggerBy: SPLIT[split],
            uMaskBy: MASK[mask],
            uOrder: ORDER[order],
            uEase: EASE[ease],
            uSeed: seed,
            uDuration: duration,
            uStagger: stagger,
            uOrigin: origin,
            uOffset: offset,
            uOffsetPercent: [(from.xPercent ?? 0) / 100, (from.yPercent ?? 0) / 100],
            uRotation: rotation,
            uScale: [from.scaleX ?? scale, from.scaleY ?? scale, from.scaleZ ?? scale],
            uOpacity: from.opacity ?? 1,
            uBlur: from.blur ?? 0,
            uWipe: typeof wipe === 'string' ? WIPE[wipe] : (wipe ?? [0, 0]),
            uWipeSoftness: wipeSoftness,
        });

        this.delay = delay;
        this._reveal = {
            split,
            order,
            duration,
            stagger,
            offset: Math.hypot(...offset),
            percent: Math.max(Math.abs(from.xPercent ?? 0), Math.abs(from.yPercent ?? 0)) / 100,
            turns: rotation.some((v) => v !== 0),
            grow: Math.max(0, scale - 1),
        };
        this._span();

        this._stop();
        this.seek(-delay);
        return this;
    }

    // timeline length + cull padding — both depend on the layout's counts/extent, so
    // setText re-derives them too
    _span() {
        const { split, order, duration, stagger, offset, percent, turns, grow } = this._reveal;
        // last unit starts at maxOrder * stagger: start/end/random span n-1, center/edges half
        const n = [this.counts.chars, this.counts.words, this.counts.lines][SPLIT[split]];
        const maxOrder = Math.max(n - 1, 0) * (order === 'center' || order === 'edges' ? 0.5 : 1);
        this.totalDuration = duration + stagger * maxOrder;

        const [l, b, r, t] = this.layout.bounds;
        const extent = Math.max(r - l, t - b);
        this._reach = offset + (percent + (turns ? 1 : 0) + grow) * extent;
        this._updateBounds();
    }

    // seconds on the reveal's own timeline; negative = still inside the delay
    seek(time) {
        this.time = Math.min(Math.max(time, -this.delay), this.totalDuration);
        this.uniforms.set({ uTimeline: Math.max(this.time, 0) });
        return this;
    }

    get progress() {
        return this.totalDuration > 0 ? Math.max(this.time, 0) / this.totalDuration : 1;
    }

    set progress(p) {
        this._stop();
        this.seek(p * this.totalDuration);
    }

    get playing() {
        return this.direction !== 0;
    }

    // resolves when the reveal reaches its end (or is interrupted by another play/reverse)
    play() {
        if (this.time >= this.totalDuration) this.seek(-this.delay);
        return this._run(1);
    }

    reverse() {
        return this._run(-1);
    }

    _run(direction) {
        this._stop();
        this.direction = direction;
        // the clock only ticks while drawn — don't bill a hidden/culled stretch as one dt
        this._lastClock = null;
        return new Promise((resolve) => (this._settle = resolve));
    }

    // halts playback and settles a pending play()/reverse() promise
    _stop() {
        this.direction = 0;
        const settle = this._settle;
        this._settle = null;
        settle?.();
    }

    update(dt) {
        if (!this.direction) return this;
        const next = this.time + dt * this.direction;
        // reversing doesn't sit out the delay again
        this.seek(this.direction < 0 ? Math.max(next, 0) : next);
        const done = this.direction > 0 ? this.time >= this.totalDuration : this.time <= 0;
        if (done) this._stop();
        return this;
    }

    draw(args) {
        const renderer = args.renderer;
        if (this.autoUpdate && renderer) {
            // a frame delta, not time since the last draw: hidden/culled stretches pause.
            // A mesh drawn into several passes sees the same time twice: dt = 0 there
            if (this._lastClock !== null && renderer.time !== this._lastClock) {
                this.update(Math.max(renderer.deltaTime, 0));
            }
            this._lastClock = renderer.time;
        }
        if (!this.glyphCount) return;
        super.draw(args);
    }

    // the shared Shader and the font outlive the text
    destroy() {
        this._stop();
        this.geometry.destroy();
        this.uniforms.destroy();
        super.destroy();
    }
}
