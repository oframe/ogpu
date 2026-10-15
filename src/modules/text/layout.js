// Pure CPU text layout over an MSDFFont (no GPU): glyph quads plus the SplitText-style
// char/word/line split, every unit carrying its own box for masks and pivots.
// Layout space: world units, +x right, +y up, one em = `size`. Boxes are [l, b, r, t].

const ALIGN = { left: 0, center: 0.5, right: 1 };
const TOP = { top: 0, middle: 0.5, bottom: 1 };

const isSpace = (cp) => cp === 0x20 || cp === 0x09 || cp === 0xa0 || cp === 0x3000;

const emptyBox = () => [Infinity, Infinity, -Infinity, -Infinity];
function grow(box, l, b, r, t) {
    box[0] = Math.min(box[0], l);
    box[1] = Math.min(box[1], b);
    box[2] = Math.max(box[2], r);
    box[3] = Math.max(box[3], t);
}

// size + width (wrap) in world units; lineHeight + letterSpacing in em
export function layoutText(font, text, { size = 1, width = Infinity, lineHeight = font.metrics.lineHeight, letterSpacing = 0, align = 'left', anchorX = 'center', anchorY = 'middle' } = {}) {
    const { ascender, descender } = font.metrics;
    const wrap = width / size;
    const fallback = font.glyph(0x3f); // '?'

    // 1. words + lines in em, pen-relative. A word = run of non-space glyphs.
    const cps = Array.from(String(text ?? ''), (c) => c.codePointAt(0));
    const lines = [[]];
    let line = lines[0];
    let word = null;
    let pen = 0;
    let prev = 0;

    const newLine = () => {
        line = [];
        lines.push(line);
        pen = 0;
        prev = 0;
    };

    for (let i = 0; i < cps.length; i++) {
        const cp = cps[i];
        if (cp === 0x0d) continue;
        if (cp === 0x0a) {
            word = null;
            newLine();
            continue;
        }

        const g = font.glyph(cp) ?? fallback;
        if (!g) continue;

        if (isSpace(cp)) {
            word = null;
            pen += (g.advance + letterSpacing) * (cp === 0x09 ? 4 : 1);
            prev = cp;
            continue;
        }

        if (!word) {
            word = { glyphs: [], x1: 0 };
            line.push(word);
        }
        pen += font.kerning(prev, cp);
        word.glyphs.push({ g, x: pen });
        word.x1 = pen + g.advance;
        pen += g.advance + letterSpacing;
        prev = cp;

        // greedy wrap at word end; a line's only word overflows rather than splitting
        const next = cps[i + 1];
        const wordEnds = next === undefined || isSpace(next) || next === 0x0a;
        if (wordEnds && word.x1 > wrap && line.length > 1) {
            line.pop();
            const shift = word.glyphs[0].x;
            for (const wg of word.glyphs) wg.x -= shift;
            word.x1 -= shift;
            newLine();
            line.push(word);
            pen = word.x1 + letterSpacing;
            prev = cp;
        }
    }

    // 2. place: block top at y = top, line 0's baseline one ascender below it
    const lineWidths = lines.map((l) => (l.length ? l[l.length - 1].x1 : 0));
    const blockWidth = Math.max(0, ...lineWidths);
    const blockHeight = ascender - descender + lineHeight * (lines.length - 1);
    const top = anchorY === 'baseline' ? ascender : (TOP[anchorY] ?? 0.5) * blockHeight;
    const left = -(ALIGN[anchorX] ?? 0.5) * blockWidth;
    const alignF = ALIGN[align] ?? 0;
    const pad = font.padEm; // quad minus this = ink; masks must hug ink, not the sdf margin

    const glyphs = [];
    const words = [];
    const lineBoxes = [];

    lines.forEach((l, li) => {
        const base = top - ascender - li * lineHeight;
        const dx = left + (blockWidth - lineWidths[li]) * alignF;
        // every unit in a line spans the line's height, like inline-block chars in the DOM —
        // that's what makes yPercent: 100 clear a line mask exactly
        const lineBox = emptyBox();
        grow(lineBox, dx, base + descender, dx, base + ascender);
        const firstGlyph = glyphs.length;
        const firstWord = words.length;

        for (const w of l) {
            const wordBox = emptyBox();
            for (const { g, x } of w.glyphs) {
                const px = dx + x;
                const charBox = [px, 0, px + g.advance, 0];
                if (g.plane) {
                    const [pl, pb, pr, pt] = g.plane;
                    charBox[0] = Math.min(charBox[0], px + pl + pad);
                    charBox[2] = Math.max(charBox[2], px + pr - pad);
                    grow(lineBox, Infinity, base + pb + pad, -Infinity, base + pt - pad);
                    glyphs.push({
                        rect: [px + pl, base + pb, px + pr, base + pt],
                        uv: g.uv,
                        char: glyphs.length,
                        word: words.length,
                        line: li,
                        charBox,
                    });
                }
                grow(wordBox, charBox[0], Infinity, charBox[2], -Infinity);
            }
            words.push(wordBox);
            grow(lineBox, wordBox[0], Infinity, wordBox[2], -Infinity);
        }

        for (let i = firstGlyph; i < glyphs.length; i++) {
            glyphs[i].charBox[1] = lineBox[1];
            glyphs[i].charBox[3] = lineBox[3];
        }
        for (let i = firstWord; i < words.length; i++) {
            words[i][1] = lineBox[1];
            words[i][3] = lineBox[3];
        }
        lineBoxes.push(lineBox);
    });

    // em -> world
    const toWorld = (b) => b.map((v) => v * size);
    const bounds = emptyBox();
    for (const gl of glyphs) {
        gl.rect = toWorld(gl.rect);
        gl.charBox = toWorld(gl.charBox);
        gl.wordBox = toWorld(words[gl.word]);
        gl.lineBox = toWorld(lineBoxes[gl.line]);
        grow(bounds, ...gl.rect);
    }

    return {
        glyphs,
        counts: { chars: glyphs.length, words: words.length, lines: lines.length },
        bounds: glyphs.length ? bounds : [0, 0, 0, 0],
        width: blockWidth * size,
        height: blockHeight * size,
    };
}
