import { Texture } from '@core/Texture';

// An msdf-atlas-gen atlas (json + png, see scripts/build-msdf-font.mjs) turned into
// em-space glyph metrics + an rgba8unorm texture. Shared by every MSDFText that uses it.
export class MSDFFont {
    // json: the parsed atlas json; image: an ImageBitmap decoded WITHOUT premultiply
    constructor(gpu, { json, image, label = 'msdf-font' }) {
        const { atlas, metrics, glyphs, kerning = [] } = json;
        if (!atlas || !glyphs) throw new Error(`[${label}] not an msdf-atlas-gen json`);
        if (!/^(msdf|mtsdf|sdf|psdf)$/.test(atlas.type)) {
            throw new Error(`[${label}] atlas type '${atlas.type}' has no distance field`);
        }

        this.gpu = gpu;
        this.label = label;
        this.type = atlas.type;
        this.pxRange = atlas.distanceRange;
        this.emPx = atlas.size; // atlas pixels per em
        // the sdf margin baked around every glyph quad, in em — ink = quad inset by this
        this.padEm = atlas.distanceRange / 2 / atlas.size;

        // -yorigin top flips both plane and atlas y; normalise to y-up planes + top-down v
        const flip = atlas.yOrigin === 'top' ? -1 : 1;
        const { width: W, height: H } = atlas;
        this.metrics = {
            emSize: metrics.emSize,
            lineHeight: metrics.lineHeight,
            ascender: Math.abs(metrics.ascender),
            descender: -Math.abs(metrics.descender),
            underlineY: metrics.underlineY * flip,
            underlineThickness: metrics.underlineThickness,
        };

        this.glyphs = new Map();
        for (const g of glyphs) {
            const entry = { advance: g.advance, plane: null, uv: null };
            const p = g.planeBounds;
            const a = g.atlasBounds;
            if (p && a) {
                const pb = Math.min(p.bottom * flip, p.top * flip);
                const pt = Math.max(p.bottom * flip, p.top * flip);
                entry.plane = [p.left, pb, p.right, pt];
                // uv laid out like plane: (u, v) at the quad's bottom-left, then top-right
                const vb = flip === 1 ? 1 - a.bottom / H : a.bottom / H;
                const vt = flip === 1 ? 1 - a.top / H : a.top / H;
                entry.uv = [a.left / W, vb, a.right / W, vt];
            }
            this.glyphs.set(g.unicode, entry);
        }

        this._kerning = new Map();
        for (const k of kerning) this._kerning.set(k.unicode1 * 0x110000 + k.unicode2, k.advance);

        // distance data is linear: never srgb, never premultiplied, no mips (minified
        // msdf blends neighbouring glyph fields)
        this.texture = new Texture(gpu, { src: image, format: 'rgba8unorm', label });
        this.sampler = gpu.device.createSampler({
            label: `${label}-sampler`,
            magFilter: 'linear',
            minFilter: 'linear',
        });
        this.ready = this.texture.ready.then(() => this);
    }

    static async load(gpu, { json, image, label }) {
        const [data, bitmap] = await Promise.all([
            typeof json === 'string' ? fetch(json).then((r) => r.json()) : json,
            fetch(image)
                .then((r) => r.blob())
                // default decode premultiplies — that multiplies the msdf channels by the
                // true-sdf alpha and wrecks the field wherever alpha < 1
                .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })),
        ]);
        return new MSDFFont(gpu, { json: data, image: bitmap, label }).ready;
    }

    glyph(cp) {
        return this.glyphs.get(cp);
    }

    kerning(a, b) {
        return this._kerning.get(a * 0x110000 + b) ?? 0;
    }

    destroy() {
        this.texture.destroy();
    }
}
