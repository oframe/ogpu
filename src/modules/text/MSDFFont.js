import { Texture } from '@core/Texture.js';

/**
 * Parsed MSDF font: BMFont-JSON metrics (glyphs, kernings, line metrics) +
 * the atlas as a Texture. Generate assets with `npm run font -- <ttf>`
 * (scripts/generate-msdf.mjs).
 *
 *   const font = await MSDFFont.load(gpu, { json: './assets/fonts/roboto.json' });
 */
export class MSDFFont {
    static async load(gpu, { json = './assets/fonts/roboto.json', png = null } = {}) {
        const res = await fetch(json);
        if (!res.ok) throw new Error(`MSDFFont: failed to fetch ${json} (${res.status})`);
        const data = await res.json();

        // atlas lives next to the json unless overridden
        const pngUrl = png ?? json.replace(/[^/]*$/, data.pages[0]);
        const texture = new Texture(gpu, { src: pngUrl, label: 'msdf-atlas' });
        await texture.ready;

        return new MSDFFont(data, texture);
    }

    constructor(data, texture) {
        this.data = data;
        this.texture = texture;

        this.size = data.info.size;
        this.lineHeight = data.common.lineHeight;
        this.baseline = data.common.base;
        this.scaleW = data.common.scaleW;
        this.scaleH = data.common.scaleH;
        this.distanceRange = data.distanceField?.distanceRange ?? 4;

        this.glyphs = new Map();
        for (const c of data.chars) this.glyphs.set(c.id, c);

        this.kernings = new Map();
        for (const k of data.kernings ?? []) this.kernings.set(`${k.first},${k.second}`, k.amount);

        this._fallback = this.glyphs.get('?'.codePointAt(0)) ?? data.chars[0];
    }

    glyph(codePoint) {
        return this.glyphs.get(codePoint) ?? this._fallback;
    }

    kerning(prevCode, code) {
        return this.kernings.get(`${prevCode},${code}`) ?? 0;
    }

    destroy() {
        this.texture.destroy();
    }
}
