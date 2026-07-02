#!/usr/bin/env node
// Generate an MSDF font atlas (PNG + BMFont JSON) into public/assets/fonts/
// via msdf-bmfont-xml. Output is committed — run once per font/charset.
//
// Usage:
//   npm run font -- path/to/Font.ttf [--size 42] [--range 4] [--charset file.txt] [--name custom-name]
//
// Atlas-size guidance: default ASCII charset fits 256-512px at size 42;
// bump --size for hero type (crisper large glyphs, bigger atlas).

import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fontFile = args.find((a) => !a.startsWith('--'));
if (!fontFile || !existsSync(fontFile)) {
    console.error('usage: npm run font -- <font.ttf|otf> [--size 42] [--range 4] [--charset file.txt] [--name out-name]');
    process.exit(1);
}

function opt(name, fallback) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const size = opt('size', '42');
const range = opt('range', '4');
const charset = opt('charset', null);
const name = opt('name', basename(fontFile, extname(fontFile)).toLowerCase());

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/fonts');
mkdirSync(outDir, { recursive: true });

const outBase = resolve(outDir, name);
const cliArgs = ['-f', 'json', '-o', `${outBase}.png`, '-s', size, '-r', range, '-t', 'msdf', '--smart-size', '--pot'];
if (charset) cliArgs.push('-i', charset);
cliArgs.push(fontFile);

const before = new Set(readdirSync(outDir));
execFileSync('npx', ['msdf-bmfont', ...cliArgs], { stdio: 'inherit' });

// msdf-bmfont names the .json after the font face, not -o — rename whatever
// json this run produced to <name>.json
if (!existsSync(`${outBase}.json`)) {
    const jsonSrc = readdirSync(outDir).find((f) => f.endsWith('.json') && !before.has(f));
    if (jsonSrc) renameSync(resolve(outDir, jsonSrc), `${outBase}.json`);
}

console.log(`\nwrote ${outBase}.png + ${outBase}.json`);
