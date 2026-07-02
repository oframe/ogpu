import { Mesh } from '@core/Mesh.js';
import { Geometry } from '@core/Geometry.js';
import { RenderPipeline } from '@core/RenderPipeline.js';
import msdfShader from './msdf.wgsl?raw';

// One quad per glyph. Layout is BMFont-style: pen starts at the top-left,
// yoffset grows downward; positions are emitted y-up with the anchor applied.
function layoutText(font, { text, fontSize, letterSpacing, lineHeight, maxWidth, align, anchorX, anchorY }) {
    const scale = fontSize / font.size;
    const lineAdvance = font.lineHeight * scale * lineHeight;

    const measure = (str) => {
        let w = 0;
        let prev = 0;
        for (const ch of str) {
            const code = ch.codePointAt(0);
            const g = font.glyph(code);
            w += (g.xadvance + font.kerning(prev, code)) * scale + letterSpacing;
            prev = code;
        }
        return w;
    };

    // wrap
    const lines = [];
    for (const raw of String(text).split('\n')) {
        if (!maxWidth) {
            lines.push(raw);
            continue;
        }
        let line = '';
        for (const word of raw.split(' ')) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && measure(candidate) > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }

    const widths = lines.map(measure);
    const blockWidth = maxWidth || Math.max(...widths, 0);
    const blockHeight = lines.length * lineAdvance;

    const shiftX = anchorX === 'center' ? -blockWidth / 2 : anchorX === 'right' ? -blockWidth : 0;
    const shiftY = anchorY === 'baseline' ? font.baseline * scale : anchorY === 'middle' ? blockHeight / 2 : anchorY === 'bottom' ? blockHeight : 0;

    let glyphCount = 0;
    for (const line of lines) for (const ch of line) if (font.glyph(ch.codePointAt(0)).width > 0) glyphCount++;

    const position = new Float32Array(glyphCount * 4 * 3);
    const uv = new Float32Array(glyphCount * 4 * 2);
    const indices = new Uint32Array(glyphCount * 6);

    let q = 0;
    lines.forEach((line, li) => {
        let penX = align === 'center' ? (blockWidth - widths[li]) / 2 : align === 'right' ? blockWidth - widths[li] : 0;
        const penY = li * lineAdvance;
        let prev = 0;

        for (const ch of line) {
            const code = ch.codePointAt(0);
            const g = font.glyph(code);
            penX += font.kerning(prev, code) * scale;

            if (g.width > 0 && g.height > 0) {
                const x0 = shiftX + penX + g.xoffset * scale;
                const x1 = x0 + g.width * scale;
                const y0 = shiftY - (penY + g.yoffset * scale);
                const y1 = y0 - g.height * scale;

                const u0 = g.x / font.scaleW;
                const u1 = (g.x + g.width) / font.scaleW;
                const v0 = g.y / font.scaleH;
                const v1 = (g.y + g.height) / font.scaleH;

                const p = q * 12;
                position.set([x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0], p);
                const t = q * 8;
                uv.set([u0, v0, u1, v0, u0, v1, u1, v1], t);
                const i = q * 6;
                const b = q * 4;
                indices.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i);
                q++;
            }

            penX += g.xadvance * scale + letterSpacing;
            prev = code;
        }
    });

    return {
        data: {
            position: { data: position, numComponents: 3, type: Float32Array },
            uv: { data: uv, numComponents: 2, type: Float32Array },
            indices,
        },
        bounds: { width: blockWidth, height: blockHeight, lines: lines.length },
    };
}

/**
 * MSDF text mesh: crisp scalable 3D text from an MSDFFont atlas. Layout
 * supports kerning, letter/line spacing, word wrap (maxWidth), per-line
 * align and block anchoring. `text.set({ text, fontSize, ... })` relayouts
 * (geometry is recreated — fine for counters, don't churn novels per frame).
 */
export class Text extends Mesh {
    constructor(
        gpu,
        {
            font,
            text = '',
            fontSize = 1,
            letterSpacing = 0,
            lineHeight = 1,
            maxWidth = 0,
            align = 'left',
            anchorX = 'left',
            anchorY = 'baseline',
            color = [1, 1, 1],
            opacity = 1,
            outlineColor = [0, 0, 0],
            outlineWidth = 0,
            softness = 0,
            billboard = false,
            depthWrite = false,
            label = 'msdf-text',
        } = {}
    ) {
        const opts = { text: String(text), fontSize, letterSpacing, lineHeight, maxWidth, align, anchorX, anchorY };
        const built = layoutText(font, opts);
        const geometry = new Geometry(gpu, { data: built.data });

        const pipeline = new RenderPipeline(gpu, {
            label: `${label}-pipeline`,
            code: msdfShader,
            vertexBuffers: geometry.bufferLayouts,
            transparent: true,
            cullMode: 'none',
            depthWrite,
        });

        const sampler = gpu.device.createSampler({
            label: `${label}-sampler`,
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        super(gpu, {
            label,
            pipeline,
            geometry,
            frustumCulled: false, // geometry swaps on set() — bounds go stale
            bindGroups: (uniformBuffer) => [
                gpu.device.createBindGroup({
                    label: `${label}-bind-group`,
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: pipeline.defs.samplers.fontSampler.binding, resource: sampler },
                        { binding: pipeline.defs.textures.tMap.binding, resource: font.texture.createView() },
                    ],
                }),
            ],
        });

        this.font = font;
        this._opts = opts;
        this.bounds = built.bounds;

        this.uniforms.set({
            uColor: color,
            uOpacity: opacity,
            uOutlineColor: outlineColor,
            uOutlineWidth: outlineWidth,
            uSoftness: softness,
            uPxRange: font.distanceRange,
            uBillboard: billboard ? 1 : 0,
        });
    }

    /** Relayout with changed options: `text.set({ text: 'hi', align: 'center' })`. */
    set(partial = {}) {
        Object.assign(this._opts, partial, partial.text !== undefined ? { text: String(partial.text) } : {});
        const built = layoutText(this.font, this._opts);
        this.geometry.destroy();
        this.geometry = new Geometry(this.gpu, { data: built.data });
        this.bounds = built.bounds;
        return this;
    }
}
