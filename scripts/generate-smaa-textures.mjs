#!/usr/bin/env node
// Fetches the SMAA area/search lookup textures and writes them to
// public/assets/smaa/. The textures are the precomputed LUTs from the
// original SMAA implementation (Jimenez et al., MIT-licensed); we pull the
// base64 PNGs embedded in three.js's SMAAPass (also MIT) rather than
// reimplementing the area-texture math. Committed output — run once, or
// again only to refresh.
//
// Usage: node scripts/generate-smaa-textures.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/mrdoob/three.js/r165/examples/jsm/postprocessing/SMAAPass.js';
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/smaa');

function pngSize(buf) {
    // IHDR width/height live at fixed offsets in a valid PNG
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const res = await fetch(SOURCE);
if (!res.ok) {
    console.error(`fetch failed: ${res.status} ${SOURCE}`);
    process.exit(1);
}
const js = await res.text();

const matches = [...js.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
if (matches.length < 2) {
    console.error(`expected 2 embedded PNGs in SMAAPass.js, found ${matches.length}`);
    process.exit(1);
}

await mkdir(outDir, { recursive: true });

let wroteArea = false;
let wroteSearch = false;
for (const m of matches) {
    const buf = Buffer.from(m[1], 'base64');
    const { width, height } = pngSize(buf);
    if (width === 160 && height === 560) {
        await writeFile(resolve(outDir, 'smaa-area.png'), buf);
        console.log(`smaa-area.png ${width}x${height} (${buf.length} bytes)`);
        wroteArea = true;
    } else if (width === 66 && height === 33) {
        // three.js ships the UNPACKED search texture (66x33), not the 64x16
        // packed original — the weights shader's search-length lookup matches
        // this unpacked layout.
        await writeFile(resolve(outDir, 'smaa-search.png'), buf);
        console.log(`smaa-search.png ${width}x${height} (${buf.length} bytes)`);
        wroteSearch = true;
    } else {
        console.warn(`skipping unexpected embedded PNG ${width}x${height}`);
    }
}

if (!wroteArea || !wroteSearch) {
    console.error('missing expected texture(s) — area 160x560, search 66x33');
    process.exit(1);
}
