#!/usr/bin/env node
// Bake a font into an MTSDF atlas (png + json) with msdf-atlas-gen, the atlas
// front-end to msdfgen: https://github.com/Chlumsky/msdf-atlas-gen
// No prebuilt macOS binary — build from source:
//   git clone --recursive https://github.com/Chlumsky/msdf-atlas-gen && cd msdf-atlas-gen
//   cmake -B out -DCMAKE_BUILD_TYPE=Release -DMSDF_ATLAS_USE_VCPKG=OFF -DMSDF_ATLAS_USE_SKIA=OFF \
//     -DMSDFGEN_USE_VCPKG=OFF -DMSDFGEN_USE_SKIA=OFF -DMSDFGEN_DISABLE_SVG=ON -DMSDF_ATLAS_NO_ARTERY_FONT=ON
//   cmake --build out -j   # needs freetype + libpng (brew install freetype libpng)
// then put out/bin/msdf-atlas-gen on PATH or point MSDF_ATLAS_GEN at it.
//
// Usage:
//   npm run build:font                                   rebake the bundled font
//   node scripts/build-msdf-font.mjs <font.ttf> <outDir> [name]
//
// Exit 0 = baked, 1 = msdf-atlas-gen failed, 2 = msdf-atlas-gen not installed.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DEFAULT_DIR = join(ROOT, 'public/assets/fonts/fira-sans');

const [font = join(DEFAULT_DIR, 'FiraSans-Bold.ttf'), outDir = DEFAULT_DIR, name] = process.argv.slice(2);
const stem = name ?? basename(font, extname(font)).toLowerCase();

// printable ASCII + the typographic punctuation and Latin-1 letters copy tends to use
const CHARSET = '[0x20, 0x7e], 0xa9, 0xb7, 0xc5, 0xc4, 0xd6, 0xe0, 0xe4, 0xe5, 0xe7, 0xe8, 0xe9, 0xf1, 0xf6, 0xf8, 0xfc, ' + '0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026';

const BIN = [process.env.MSDF_ATLAS_GEN, 'msdf-atlas-gen'].filter(Boolean).find((bin) => {
    const r = spawnSync(bin, ['-help'], { encoding: 'utf8', timeout: 5000 });
    return !r.error;
});

if (!BIN) {
    console.error('msdf-atlas-gen not found — build it (see the header of this script)');
    console.error('and put it on PATH, or set MSDF_ATLAS_GEN=/path/to/msdf-atlas-gen');
    process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const png = join(outDir, `${stem}.png`);
const json = join(outDir, `${stem}.json`);

// mtsdf: rgb = multi-channel distance (sharp corners), a = true sdf (outlines/glow).
// pxrange caps how wide an outline/shadow can reach in the shader — keep it generous.
const r = spawnSync(BIN, ['-font', font, '-chars', CHARSET, '-type', 'mtsdf', '-format', 'png', '-imageout', png, '-json', json, '-minsize', '48', '-pxrange', '16', '-pots', '-threads', '0'], {
    encoding: 'utf8',
    stdio: 'inherit',
});

if (r.status !== 0) process.exit(1);
console.log(`baked ${relative(ROOT, png)} + ${relative(ROOT, json)}`);
