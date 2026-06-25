#!/usr/bin/env node
//
// The spherical-harmonics math (computeShBasis, Ki/Kml, computeTruncatedCosSh,
// preprocessSHForShader and constants) is a port of Google Filament's
// libs/ibl/src/CubemapSH.cpp, modified to run in JS over an equirectangular
// source instead of a cubemap. Filament is:
//
//   Copyright (C) Google LLC. Licensed under the Apache License, Version 2.0.
//   https://github.com/google/filament — https://www.apache.org/licenses/LICENSE-2.0
//
// ---------------------------------------------------------------------------
//
// Generate the SH irradiance JSON consumed by loadSphericalHarmonics() from an
// equirectangular HDR/EXR environment map. Direct port of Filament's
// libs/ibl (CubemapSH.cpp): computeSH(irradiance=true) -> preprocessSHForShader.
// The output coefficients plug straight into pbr.wgsl's bare-polynomial
// evaluateSH() with the diffuse term `albedo * evaluateSH(n)` (no /PI — the
// Lambert 1/PI and the cosine-lobe PI are baked in, hence "scaled by PI").
//
// Usage: node tools/generateSH.mjs <input.hdr|.exr>
//   writes <input dir>/<basename>_sh.json next to the env map.
//
// Self-check: node tools/generateSH.mjs --selfcheck

import { readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import parseExr from 'parse-exr';

const NUM_BANDS = 3;
const NUM_COEFS = NUM_BANDS * NUM_BANDS; // 9
const PI = Math.PI;
const F_2_SQRTPI = 1.1283791670955126; // 2/sqrt(pi)
const SQRT2 = Math.SQRT2;
const COEF_NAMES = ['L00', 'L1-1', 'L10', 'L11', 'L2-2', 'L2-1', 'L20', 'L21', 'L22'];

const shIndex = (m, l) => l * (l + 1) + m;

// ---- Filament CubemapSH math (verbatim port) ----

// Un-normalized real SH polynomials at unit direction s=[x,y,z] (z = polar axis,
// matching evaluateSH's (3z^2-1) term). Ki/cosine-lobe applied separately.
function computeShBasis(s) {
    const SHb = new Array(NUM_COEFS).fill(0);
    const [x, y, z] = s;

    let Pml_2 = 0;
    let Pml_1 = 1;
    SHb[0] = Pml_1;
    for (let l = 1; l < NUM_BANDS; l++) {
        const Pml = ((2 * l - 1.0) * Pml_1 * z - (l - 1.0) * Pml_2) / l;
        Pml_2 = Pml_1;
        Pml_1 = Pml;
        SHb[shIndex(0, l)] = Pml_1;
    }

    let Pmm = 1;
    for (let m = 1; m < NUM_BANDS; m++) {
        Pmm = (1.0 - 2 * m) * Pmm;
        Pml_2 = Pmm;
        Pml_1 = (2 * m + 1.0) * Pmm * z;
        SHb[shIndex(-m, m)] = Pml_2;
        SHb[shIndex(m, m)] = Pml_2;
        if (m + 1 < NUM_BANDS) {
            SHb[shIndex(-m, m + 1)] = Pml_1;
            SHb[shIndex(m, m + 1)] = Pml_1;
            for (let l = m + 2; l < NUM_BANDS; l++) {
                const Pml = ((2 * l - 1.0) * Pml_1 * z - (l + m - 1.0) * Pml_2) / (l - m);
                Pml_2 = Pml_1;
                Pml_1 = Pml;
                SHb[shIndex(-m, l)] = Pml_1;
                SHb[shIndex(m, l)] = Pml_1;
            }
        }
    }

    let Cm = x;
    let Sm = y;
    for (let m = 1; m <= NUM_BANDS; m++) {
        for (let l = m; l < NUM_BANDS; l++) {
            SHb[shIndex(-m, l)] *= Sm;
            SHb[shIndex(m, l)] *= Cm;
        }
        const Cm1 = Cm * x - Sm * y;
        const Sm1 = Sm * x + Cm * y;
        Cm = Cm1;
        Sm = Sm1;
    }
    return SHb;
}

// n!/d!
function factorial(n, d = 1) {
    d = Math.max(1, d);
    n = Math.max(1, n);
    let r = 1.0;
    if (n === d) {
        // 1
    } else if (n > d) {
        for (; n > d; n--) r *= n;
    } else {
        for (; d > n; d--) r *= d;
        r = 1.0 / r;
    }
    return r;
}

function Kml(m, l) {
    m = m < 0 ? -m : m;
    const K = (2 * l + 1) * factorial(l - m, l + m);
    return Math.sqrt(K) * (F_2_SQRTPI * 0.25); // sqrt(K) / (2*sqrt(pi))
}

function Ki() {
    const K = new Array(NUM_COEFS);
    for (let l = 0; l < NUM_BANDS; l++) {
        K[shIndex(0, l)] = Kml(0, l);
        for (let m = 1; m <= l; m++) {
            K[shIndex(m, l)] = K[shIndex(-m, l)] = SQRT2 * Kml(m, l);
        }
    }
    return K;
}

// Truncated cosine-lobe convolution per band: A0=PI, A1=2PI/3, A2=-PI/4 (odd l>1 = 0).
function computeTruncatedCosSh(l) {
    if (l === 0) return PI;
    if (l === 1) return (2 * PI) / 3;
    if (l & 1) return 0;
    const l_2 = l / 2;
    const A0 = (l_2 & 1 ? 1.0 : -1.0) / ((l + 2) * (l - 1));
    const A1 = factorial(l, l_2) / (factorial(l_2) * (1 << l));
    return 2 * PI * A0 * A1;
}

// preprocessSHForShader: bake polynomial constants + Lambert 1/PI so the shader
// uses the bare polynomial form.
const M_SQRT_PI = 1.7724538509;
const M_SQRT_3 = 1.7320508076;
const M_SQRT_5 = 2.2360679775;
const M_SQRT_15 = 3.8729833462;
const SHADER_A = [
    1.0 / (2.0 * M_SQRT_PI),
    -M_SQRT_3 / (2.0 * M_SQRT_PI),
    M_SQRT_3 / (2.0 * M_SQRT_PI),
    -M_SQRT_3 / (2.0 * M_SQRT_PI),
    M_SQRT_15 / (2.0 * M_SQRT_PI),
    -M_SQRT_15 / (2.0 * M_SQRT_PI),
    M_SQRT_5 / (4.0 * M_SQRT_PI),
    -M_SQRT_15 / (2.0 * M_SQRT_PI),
    M_SQRT_15 / (4.0 * M_SQRT_PI),
];

// l for each flat coefficient index.
const COEF_BAND = [0, 1, 1, 1, 2, 2, 2, 2, 2];

// Integrate an equirectangular RGB image -> 9 shader-ready RGB SH coefficients.
// sample(dir) -> [r,g,b] radiance. width/height define the quadrature grid.
function integrateSH(width, height, sample) {
    const sh = Array.from({ length: NUM_COEFS }, () => [0, 0, 0]);
    const dPhi = (2 * PI) / width;
    const dTheta = PI / height;

    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        const elev = (0.5 - v) * PI; // latitude in [-PI/2, PI/2]
        const cosE = Math.cos(elev);
        const dy = Math.sin(elev);
        const dOmega = cosE * dTheta * dPhi; // sin(polar) = cos(elev)
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const phi = (u - 0.5) * 2 * PI; // matches equirectUV: atan2(d.x,d.z)
            const dir = [cosE * Math.sin(phi), dy, cosE * Math.cos(phi)];
            const c = sample(x, y, dir);
            const basis = computeShBasis(dir);
            for (let i = 0; i < NUM_COEFS; i++) {
                const b = basis[i] * dOmega;
                sh[i][0] += c[0] * b;
                sh[i][1] += c[1] * b;
                sh[i][2] += c[2] * b;
            }
        }
    }

    // Ki normalization * irradiance cosine lobe, then shader preprocess (A * 1/PI).
    const K = Ki();
    for (let i = 0; i < NUM_COEFS; i++) {
        const f = K[i] * computeTruncatedCosSh(COEF_BAND[i]) * SHADER_A[i] * (1 / PI);
        sh[i][0] *= f;
        sh[i][1] *= f;
        sh[i][2] *= f;
    }
    return sh;
}

// ---- image decoders ----

function loadEXR(buf) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { width, height, data } = parseExr(ab, 1015 /* FloatType */);
    return { width, height, data, channels: 4 };
}

// Radiance .hdr (RGBE), new-style RLE + flat fallback.
function loadHDR(buf) {
    // header
    let pos = 0;
    const readLine = () => {
        let s = '';
        while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]);
        pos++;
        return s;
    };
    if (!readLine().startsWith('#?')) throw new Error('not a Radiance HDR file');
    while (readLine() !== '') {
        /* skip header vars (FORMAT=..., etc.) until blank line */
    }
    const res = readLine().split(' ');
    const height = parseInt(res[1], 10);
    const width = parseInt(res[3], 10);

    const data = new Float32Array(width * height * 4);
    const scanline = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
        // new RLE header: 2,2,hi,lo
        const r0 = buf[pos];
        const r1 = buf[pos + 1];
        const sw = (buf[pos + 2] << 8) | buf[pos + 3];
        if (r0 === 2 && r1 === 2 && sw === width && width >= 8 && width < 32768) {
            pos += 4;
            for (let ch = 0; ch < 4; ch++) {
                let x = 0;
                while (x < width) {
                    let count = buf[pos++];
                    if (count > 128) {
                        // run
                        count -= 128;
                        const val = buf[pos++];
                        while (count-- > 0) scanline[x++ * 4 + ch] = val;
                    } else {
                        // dump
                        while (count-- > 0) scanline[x++ * 4 + ch] = buf[pos++];
                    }
                }
            }
        } else {
            // flat scanline
            for (let x = 0; x < width; x++) {
                scanline[x * 4 + 0] = buf[pos++];
                scanline[x * 4 + 1] = buf[pos++];
                scanline[x * 4 + 2] = buf[pos++];
                scanline[x * 4 + 3] = buf[pos++];
            }
        }
        // RGBE -> float
        for (let x = 0; x < width; x++) {
            const e = scanline[x * 4 + 3];
            const o = (y * width + x) * 4;
            if (e === 0) {
                data[o] = data[o + 1] = data[o + 2] = 0;
            } else {
                const f = Math.pow(2, e - 128 - 8);
                data[o] = scanline[x * 4 + 0] * f;
                data[o + 1] = scanline[x * 4 + 1] * f;
                data[o + 2] = scanline[x * 4 + 2] * f;
            }
            data[o + 3] = 1;
        }
    }
    return { width, height, data, channels: 4 };
}

function loadImage(file) {
    const buf = readFileSync(file);
    if (file.toLowerCase().endsWith('.exr')) return loadEXR(buf);
    if (file.toLowerCase().endsWith('.hdr')) return loadHDR(buf);
    throw new Error(`unsupported input (need .hdr or .exr): ${file}`);
}

function toJSON(sh) {
    return JSON.stringify(
        {
            bands: NUM_BANDS,
            irradiance: true,
            coefficients: sh.map((rgb, i) => ({ name: COEF_NAMES[i], rgb })),
        },
        null,
        2
    );
}

// reference evaluateSH (must match pbr.wgsl) — for self-check
function evaluateSH(sh, n) {
    const [x, y, z] = n;
    const out = [0, 0, 0];
    const terms = [1, y, z, x, y * x, y * z, 3 * z * z - 1, x * z, x * x - y * y];
    for (let i = 0; i < NUM_COEFS; i++) for (let k = 0; k < 3; k++) out[k] += sh[i][k] * terms[i];
    return out;
}

function selfcheck() {
    // Constant white environment (radiance 1): irradiance is uniform, diffuse
    // surface reflects albedo*1, so evaluateSH must return ~1 in every direction
    // and all non-DC coefficients ~0.
    const sh = integrateSH(64, 32, () => [1, 1, 1]);
    const assert = (cond, msg) => {
        if (!cond) throw new Error(`selfcheck FAILED: ${msg}`);
    };
    assert(Math.abs(sh[0][0] - 1) < 1e-3, `DC=${sh[0][0]} expected 1`);
    for (let i = 1; i < NUM_COEFS; i++) assert(Math.abs(sh[i][0]) < 1e-3, `coef ${i}=${sh[i][0]} expected 0`);
    for (const n of [
        [0, 1, 0],
        [0.577, 0.577, 0.577],
        [-0.5, 0.1, 0.86],
    ]) {
        const e = evaluateSH(sh, n)[0];
        assert(Math.abs(e - 1) < 1e-3, `evaluateSH(${n})=${e} expected 1`);
    }
    console.log('selfcheck OK: constant white env -> evaluateSH == 1');
}

function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--selfcheck') return selfcheck();
    if (!args[0]) {
        console.error('usage: node tools/generateSH.mjs <input.hdr|.exr>');
        process.exit(1);
    }
    const input = args[0];
    if (basename(input).toLowerCase().includes('oct')) {
        console.error('error: input looks octahedral; this script expects an equirectangular map');
        process.exit(1);
    }
    // Always write next to the input env map.
    const output = join(dirname(input), basename(input).replace(/\.(hdr|exr)$/i, '') + '_sh.json');

    const { width, height, data, channels } = loadImage(input);
    const sh = integrateSH(width, height, (x, y) => {
        const o = (y * width + x) * channels;
        return [data[o], data[o + 1], data[o + 2]];
    });
    writeFileSync(output, toJSON(sh) + '\n');
    console.log(`wrote ${output} (${width}x${height})`);
    sh.forEach((rgb, i) => console.log(`  ${COEF_NAMES[i].padEnd(5)} ${rgb.map((v) => v.toFixed(6)).join(', ')}`));
}

main();
