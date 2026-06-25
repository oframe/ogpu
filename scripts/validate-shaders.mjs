#!/usr/bin/env node
// Validate every WGSL shader under src/ with naga (the wgpu reference compiler).
// Install naga first:  brew install naga   (or  cargo install naga-cli)
//
// Usage:
//   npm run validate:shaders            validate all src/**/*.wgsl
//   node scripts/validate-shaders.mjs path/to/one.wgsl [more.wgsl ...]
//
// Exit 0 = all valid, 1 = a shader failed, 2 = naga not installed.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function hasNaga() {
    const r = spawnSync('naga', ['--version'], { encoding: 'utf8' });
    return !r.error && r.status === 0;
}

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith('.wgsl')) out.push(p);
    }
    return out;
}

if (!hasNaga()) {
    console.error('naga not found. Install it for WGSL validation:');
    console.error('  brew install naga      # macOS / Linux (Homebrew)');
    console.error('  cargo install naga-cli # any platform with Rust');
    process.exit(2);
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : walk(SRC).sort();

let failed = 0;
for (const file of files) {
    const r = spawnSync('naga', [file], { encoding: 'utf8' });
    const rel = relative(ROOT, file);
    if (r.status === 0) {
        console.log(`ok   ${rel}`);
    } else {
        failed++;
        console.error(`FAIL ${rel}`);
        const msg = (r.stderr || r.stdout || '').trimEnd();
        if (msg) console.error(msg.replace(/^/gm, '     '));
    }
}

console.log(`\n${files.length - failed}/${files.length} valid`);
process.exit(failed ? 1 : 0);
