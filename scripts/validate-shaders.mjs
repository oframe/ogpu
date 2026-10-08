#!/usr/bin/env node
// Validate every WGSL shader in the repo with naga (the wgpu reference compiler).
// Install naga first:  brew install naga-cli   (or  cargo install naga-cli)
// Not `brew install naga` — that formula is a Snake game and conflicts on the `naga` binary.
//
// Usage:
//   npm run validate:shaders            validate all **/*.wgsl
//   node scripts/validate-shaders.mjs path/to/one.wgsl [more.wgsl ...]
//
// Exit 0 = all valid, 1 = a shader failed, 2 = naga not installed.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

// Scope is the parent of this script's directory — so in a monorepo, dropping this
// in packages/foo/scripts/ validates only that package, at the root it validates all.
const ROOT = new URL('..', import.meta.url).pathname;
// Walk the whole tree, not just src/ — most shaders live in examples/. Skipping is
// about not descending into generated/vendored dirs, which can be huge (target/).
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', 'coverage', 'vendor']);

// PATH first, then cargo's default install location
const NAGA = ['naga', join(homedir(), '.cargo/bin/naga')].find(isNaga);

function isNaga(bin) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    // ANSI escapes in the output = Homebrew's `naga` Snake game, not naga-cli
    // eslint-disable-next-line no-control-regex
    return !r.error && r.status === 0 && !/\x1b\[/.test((r.stdout || '') + (r.stderr || ''));
}

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith('.wgsl')) out.push(p);
    }
    return out;
}

if (!NAGA) {
    console.error('naga not found. Install it for WGSL validation:');
    console.error('  brew install naga-cli  # macOS / Linux (Homebrew) — NOT `naga`, that is a Snake game');
    console.error('  cargo install naga-cli # any platform with Rust');
    process.exit(2);
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : walk(ROOT).sort();

let failed = 0;
for (const file of files) {
    const r = spawnSync(NAGA, [file], { encoding: 'utf8' });
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
