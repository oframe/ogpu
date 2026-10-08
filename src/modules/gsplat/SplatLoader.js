/**
 * @module SplatLoader
 *
 * Gaussian Splat file loader.
 * Supports INRIA .ply, antimatter15 .splat, Niantic .spz (v1–3), and
 * PlayCanvas .sog (v2 bundled ZIP and unbundled meta.json).
 *
 * @example
 * import { loadSplat } from '@modules/gsplat/SplatLoader.js';
 * const data = await loadSplat('./scene.ply');
 * // data.count, data.positions, data.colors, data.rotations, data.scales, data.sh
 */

import { decodePly } from './loaders/ply.js';
import { decodeSplat } from './loaders/splat.js';
import { decodeSpz } from './loaders/spz.js';
import { decodeSog, decodeSogUnbundled } from './loaders/sog.js';

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
const SPZ_MAGIC = 0x5053474e; // 'NGSP' LE
const ZIP_MAGIC = 0x04034b50; // 'PK\x03\x04' LE

/**
 * Detect splat format from the first bytes of a buffer.
 *
 * @param {ArrayBuffer} buffer
 * @returns {'ply'|'splat'|'spz'|'sog'}
 */
function detectFormat(buffer) {
    if (buffer.byteLength < 4) throw new Error('SplatLoader: buffer too small to detect format');
    const dv = new DataView(buffer);

    // PLY: starts with ascii 'ply\n' = 0x706c790a big-endian (or check bytes)
    const b0 = dv.getUint8(0);
    const b1 = dv.getUint8(1);
    const b2 = dv.getUint8(2);
    const b3 = dv.getUint8(3);

    // 'p','l','y','\n'
    if (b0 === 0x70 && b1 === 0x6c && b2 === 0x79 && b3 === 0x0a) return 'ply';

    // Gzip (SPZ compressed) or raw SPZ magic
    if (b0 === GZIP_MAGIC_0 && b1 === GZIP_MAGIC_1) return 'spz';

    // SPZ magic uncompressed: 'NGSP' = 0x4e, 0x47, 0x53, 0x50
    const magic32le = dv.getUint32(0, true);
    if (magic32le === SPZ_MAGIC) return 'spz';

    // ZIP (SOG)
    if (magic32le === ZIP_MAGIC) return 'sog';

    // Default: assume .splat (no header)
    return 'splat';
}

/**
 * Infer format from a URL extension.
 * @param {string} url
 * @returns {'ply'|'splat'|'spz'|'sog'|null}
 */
function formatFromUrl(url) {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    if (clean.endsWith('.ply')) return 'ply';
    if (clean.endsWith('.splat')) return 'splat';
    if (clean.endsWith('.spz')) return 'spz';
    if (clean.endsWith('.sog')) return 'sog';
    if (clean.endsWith('meta.json') || clean.endsWith('/meta.json')) return 'sog';
    return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SplatData
 * @property {number}       count                         Number of Gaussians.
 * @property {Float32Array} positions  count×4: [x,y,z,0] world positions.
 * @property {Float32Array} colors     count×4: [r,g,b,a] in [0,1] gamma space.
 *   r/g/b = 0.5 + SH_C0 * f_dc_i (already applied).
 *   a = opacity in [0,1] (sigmoid already applied where relevant).
 * @property {Float32Array} rotations  count×4: normalised quaternion [x,y,z,w].
 * @property {Float32Array} scales     count×4: linear world-space std devs [sx,sy,sz,0].
 *   exp() already applied to log-scales where the source format uses log encoding.
 * @property {null|{bands:number, coeffs:Float32Array}} sh
 *   Reserved for higher-order spherical harmonics.  null in v1 of this loader.
 */

/**
 * Load and decode a Gaussian Splat file.
 *
 * @param {string|ArrayBuffer} src
 *   URL string → fetched; ArrayBuffer → decoded directly.
 *   Special case: if `src` is a URL ending in `meta.json`, the unbundled
 *   PlayCanvas SOG variant is used and sibling WebP images are fetched
 *   relative to that URL.
 *
 * @param {{ type?: 'ply'|'splat'|'spz'|'sog' }} [options]
 *   `type` overrides automatic format detection from the URL extension or
 *   magic bytes.
 *
 * @returns {Promise<SplatData>}
 */
export async function loadSplat(src, { type } = {}) {
    // --- Unbundled SOG via meta.json URL (special-cased before fetch) ---
    if (typeof src === 'string' && src.split('?')[0].split('#')[0].toLowerCase().endsWith('meta.json')) {
        return decodeSogUnbundled(src);
    }

    // --- Fetch if URL ---
    let buffer;
    if (typeof src === 'string') {
        const res = await fetch(src);
        if (!res.ok) {
            throw new Error(`SplatLoader: fetch failed for "${src}" — HTTP ${res.status}`);
        }
        buffer = await res.arrayBuffer();
    } else {
        buffer = src;
    }

    // --- Determine format ---
    let fmt = type;
    if (!fmt && typeof src === 'string') {
        fmt = formatFromUrl(src);
    }
    if (!fmt) {
        fmt = detectFormat(buffer);
    }

    // --- Dispatch to format-specific decoder ---
    switch (fmt) {
        case 'ply':
            return decodePly(buffer);

        case 'splat':
            return decodeSplat(buffer);

        case 'spz':
            return decodeSpz(buffer);

        case 'sog':
            return decodeSog(buffer);

        default:
            throw new Error(`SplatLoader: unknown format "${fmt}"`);
    }
}
