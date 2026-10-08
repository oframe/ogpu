/**
 * PlayCanvas .sog (Structure of Gaussians) v2 loader.
 *
 * A .sog file is a ZIP archive (entries typically STORED or DEFLATE).
 * Contents:
 *   meta.json           { version:2, count, means:{mins,maxs,files}, scales:{codebook,files},
 *                         quats:{files}, sh0:{codebook,files}, shN?:{...} }
 *   means_l.webp        16-bit quantised position low byte
 *   means_u.webp        16-bit quantised position high byte
 *   quats.webp          smallest-3 quaternion encoding + mode in alpha
 *   scales.webp         scale codebook index per axis
 *   sh0.webp            sh0 codebook index rgb + opacity in alpha
 *   (optional shN_centroids.webp, shN_labels.webp — parsed but SH left null)
 *
 * Verified against playcanvas/engine src/scene/gsplat/gsplat-sog-data.js:
 *   - scales codebook values are LOG-space (decompress() writes them straight
 *     into PLY scale_0..2, which are log); linear = exp(codebook[idx])
 *   - sh0 alpha / 255 = direct opacity, no sigmoid
 *   - quat modes (a=r,b=g,c=b decoded; d = reconstructed missing comp):
 *       mode 0: [x=a, y=b, z=c, w=d]
 *       mode 1: [x=d, y=b, z=c, w=a]
 *       mode 2: [x=b, y=d, z=c, w=a]
 *       mode 3: [x=b, y=c, z=d, w=a]
 *   - means use sign(v)*(exp(|v|)-1) after linear interpolation
 *
 * ─── Credits & sources ───────────────────────────────────────────────────────
 * SOG (Spatially Ordered Gaussians) format by PlayCanvas.
 *   - Format spec:        https://github.com/playcanvas/spz-sog (SOG v2 spec)
 *   - Reference decoder:  https://github.com/playcanvas/engine
 *                         src/scene/gsplat/gsplat-sog-data.js
 *                         (decode math for means / quats / scales / sh0 verified
 *                          line-by-line against this file)
 *   - SOG announcement:   https://blog.playcanvas.com/compressing-gaussian-splats-with-sog/
 *   - SuperSplat tooling: https://github.com/playcanvas/supersplat (produces .sog)
 *
 * WebP decode path uses the WebCodecs ImageDecoder API:
 *   - https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
 *
 * Original 3D Gaussian Splatting (the SH_C0 DC term, opacity/scale encoding):
 *   Kerbl, Kopanas, Leimkühler, Drettakis — "3D Gaussian Splatting for
 *   Real-Time Radiance Field Rendering", SIGGRAPH 2023.
 *   - https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
 *   - https://github.com/graphdeco-inria/gaussian-splatting
 */

const SH_C0 = 0.28209479177387814;

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Locate the End-of-Central-Directory record by scanning backwards.
 * @param {DataView} dv
 * @returns {number} offset of EOCD signature
 */
function findEocd(dv) {
    // EOCD is at least 22 bytes; comment can be up to 65535 bytes
    const minOff = Math.max(0, dv.byteLength - 65557);
    for (let i = dv.byteLength - 22; i >= minOff; i--) {
        if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('SOG/ZIP: End of Central Directory not found');
}

/**
 * Read a null-terminated or fixed-length UTF-8 string.
 * @param {Uint8Array} u8
 * @param {number} off
 * @param {number} len
 * @returns {string}
 */
function readUtf8(u8, off, len) {
    return new TextDecoder().decode(u8.subarray(off, off + len));
}

/**
 * Parse the ZIP central directory and return a map of filename → entry info.
 * @param {ArrayBuffer} buffer
 * @returns {Map<string, {offset:number, method:number, compressedSize:number, uncompressedSize:number}>}
 */
function parseZip(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    const eocdOff = findEocd(dv);

    const cdCount = dv.getUint16(eocdOff + 10, true);
    const cdOffset = dv.getUint32(eocdOff + 16, true);

    const entries = new Map();
    let pos = cdOffset;

    for (let i = 0; i < cdCount; i++) {
        if (dv.getUint32(pos, true) !== SIG_CENTRAL) {
            throw new Error(`SOG/ZIP: expected central directory signature at offset ${pos}`);
        }
        const method = dv.getUint16(pos + 10, true);
        const compressedSize = dv.getUint32(pos + 20, true);
        const uncompressedSize = dv.getUint32(pos + 24, true);
        const nameLen = dv.getUint16(pos + 28, true);
        const extraLen = dv.getUint16(pos + 30, true);
        const commentLen = dv.getUint16(pos + 32, true);
        const localHeaderOffset = dv.getUint32(pos + 42, true);

        const name = readUtf8(u8, pos + 46, nameLen);
        entries.set(name, { offset: localHeaderOffset, method, compressedSize, uncompressedSize });

        pos += 46 + nameLen + extraLen + commentLen;
    }

    if (entries.size === 0) throw new Error('SOG/ZIP: no entries found in central directory');
    return entries;
}

/**
 * Read the raw bytes of a ZIP entry (decompressing if necessary).
 * @param {ArrayBuffer} buffer
 * @param {{ offset:number, method:number, compressedSize:number, uncompressedSize:number }} entry
 * @returns {Promise<Uint8Array>}
 */
async function readZipEntry(buffer, entry) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    const lhOff = entry.offset;
    if (dv.getUint32(lhOff, true) !== SIG_LOCAL) {
        throw new Error(`SOG/ZIP: expected local file header signature at offset ${lhOff}`);
    }

    // Local header extra field length can differ from central directory
    const lhNameLen = dv.getUint16(lhOff + 26, true);
    const lhExtraLen = dv.getUint16(lhOff + 28, true);
    const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;

    const compressed = u8.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) {
        // STORED
        return compressed.slice();
    } else if (entry.method === 8) {
        // DEFLATE (raw, no gzip wrapper)
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
    } else {
        throw new Error(`SOG/ZIP: unsupported compression method ${entry.method}`);
    }
}

// ---------------------------------------------------------------------------
// WebP pixel extraction
// ---------------------------------------------------------------------------

/**
 * Decode a WebP blob to RGBA pixels without premultiplied-alpha corruption.
 *
 * Preferred path: WebCodecs ImageDecoder (available in Chrome 94+).
 * Fallback: createImageBitmap with premultiplyAlpha:'none' + 2D canvas.
 *
 * @param {Uint8Array} data
 * @returns {Promise<{pixels: Uint8Array, width: number, height: number}>}
 */
async function decodeWebp(data) {
    const blob = new Blob([data], { type: 'image/webp' });

    // --- WebCodecs path ---
    if (typeof ImageDecoder !== 'undefined') {
        try {
            const decoder = new ImageDecoder({ data: data.buffer, type: 'image/webp' });
            const result = await decoder.decode();
            const frame = result.image;
            const { displayWidth: width, displayHeight: height } = frame;

            let pixels;
            try {
                const buf = new Uint8Array(width * height * 4);
                await frame.copyTo(buf, { format: 'RGBA' });
                pixels = buf;
            } catch {
                // copyTo format conversion not supported — fall through
                pixels = null;
            }
            frame.close();
            decoder.close();

            if (pixels) return { pixels, width, height };
        } catch {
            // ImageDecoder failed — fall through to canvas path
        }
    }

    // --- Canvas fallback ---
    const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
    });
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = ctx.getImageData(0, 0, width, height);
    return { pixels: new Uint8Array(imageData.data.buffer), width, height };
}

// ---------------------------------------------------------------------------
// Per-gaussian pixel accessor
// ---------------------------------------------------------------------------

/**
 * @param {{ pixels: Uint8Array, width: number }} img
 * @param {number} i  Gaussian index (row-major)
 * @returns {[number,number,number,number]} RGBA bytes
 */
function getPixel(img, i) {
    const base = i * 4;
    return [img.pixels[base], img.pixels[base + 1], img.pixels[base + 2], img.pixels[base + 3]];
}

// ---------------------------------------------------------------------------
// Lerp helper
// ---------------------------------------------------------------------------
function lerp(a, b, t) {
    return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Main decoder
// ---------------------------------------------------------------------------

/**
 * Decode a PlayCanvas .sog v2 ArrayBuffer into SplatData.
 *
 * Also supports the "unbundled" variant where `src` ends in `meta.json`:
 * in that case pass the parsed meta object and a `fetchRelative` function
 * (called via SplatLoader — not handled here; this function only processes
 * a fully-assembled buffer map produced by the loader).
 *
 * @param {ArrayBuffer|null} buffer   Raw .sog ZIP bytes, or null when using imageMap.
 * @param {{ meta?: object, imageMap?: Map<string,Uint8Array> }} [opts]
 * @returns {Promise<import('../SplatLoader.js').SplatData>}
 */
export async function decodeSog(buffer, opts = {}) {
    let meta;
    let imageMap;

    if (opts.meta && opts.imageMap) {
        // Unbundled variant — meta + images provided directly
        meta = opts.meta;
        imageMap = opts.imageMap;
    } else {
        // Bundled .sog ZIP
        const entries = parseZip(buffer);

        // Read meta.json
        const metaEntry = entries.get('meta.json');
        if (!metaEntry) throw new Error('SOG: meta.json not found in archive');
        const metaBytes = await readZipEntry(buffer, metaEntry);
        meta = JSON.parse(new TextDecoder().decode(metaBytes));

        if (meta.version !== 2) {
            throw new Error(`SOG: only version 2 is supported, got version ${meta.version}`);
        }

        // Read all referenced WebP images
        imageMap = new Map();
        for (const [entryName] of entries) {
            if (entryName.endsWith('.webp')) {
                imageMap.set(entryName, await readZipEntry(buffer, entries.get(entryName)));
            }
        }
    }

    if (meta.version !== 2) {
        throw new Error(`SOG: only version 2 is supported, got version ${meta.version}`);
    }

    const count = meta.count;
    if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`SOG: invalid count ${count}`);
    }

    // Decode WebP images
    const decodeImg = async (filename) => {
        const bytes = imageMap.get(filename);
        if (!bytes) throw new Error(`SOG: missing image "${filename}"`);
        return decodeWebp(bytes);
    };

    // meta.means.files = ['means_l.webp', 'means_u.webp']
    // Other fields: files = ['<name>.webp'] (single-entry array)
    const [meansL, meansU, quatsImg, scalesImg, sh0Img] = await Promise.all([
        decodeImg(meta.means.files[0]),
        decodeImg(meta.means.files[1]),
        decodeImg(meta.quats.files[0]),
        decodeImg(meta.scales.files[0]),
        decodeImg(meta.sh0.files[0]),
    ]);

    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 4);

    const { mins: mMins, maxs: mMaxs } = meta.means;
    const scalesCodebook = meta.scales.codebook.map(Math.exp); // 256-entry array, log → linear
    const sh0Codebook = meta.sh0.codebook; // 256-entry array, SH DC coefficients

    const NORM = Math.SQRT2;

    for (let i = 0; i < count; i++) {
        // --- Means/Positions ---
        // q16 = (u_channel << 8) | l_channel per axis; n = q16 / 65535
        // logv = lerp(min, max, n); v = sign(logv) * (exp(|logv|) - 1)
        const [lR, lG, lB] = getPixel(meansL, i);
        const [uR, uG, uB] = getPixel(meansU, i);

        const q16x = ((uR << 8) | lR) & 0xffff;
        const q16y = ((uG << 8) | lG) & 0xffff;
        const q16z = ((uB << 8) | lB) & 0xffff;

        const nx = q16x / 65535;
        const ny = q16y / 65535;
        const nz = q16z / 65535;

        const logvx = lerp(mMins[0], mMaxs[0], nx);
        const logvy = lerp(mMins[1], mMaxs[1], ny);
        const logvz = lerp(mMins[2], mMaxs[2], nz);

        positions[i * 4 + 0] = Math.sign(logvx) * (Math.exp(Math.abs(logvx)) - 1);
        positions[i * 4 + 1] = Math.sign(logvy) * (Math.exp(Math.abs(logvy)) - 1);
        positions[i * 4 + 2] = Math.sign(logvz) * (Math.exp(Math.abs(logvz)) - 1);
        positions[i * 4 + 3] = 0;

        // --- Quaternions ---
        // a=r, b=g, c=b decoded components; mode = alpha - 252
        // Verified against playcanvas/engine gsplat-sog-data.js:
        //   mode 0 → r.set(a,b,c,d) → [x=a,y=b,z=c,w=d]
        //   mode 1 → r.set(d,b,c,a) → [x=d,y=b,z=c,w=a]
        //   mode 2 → r.set(b,d,c,a) → [x=b,y=d,z=c,w=a]
        //   mode 3 → r.set(b,c,d,a) → [x=b,y=c,z=d,w=a]
        const [qR, qG, qB, qA] = getPixel(quatsImg, i);
        const qa = (qR / 255 - 0.5) * NORM;
        const qb = (qG / 255 - 0.5) * NORM;
        const qc = (qB / 255 - 0.5) * NORM;
        const qd = Math.sqrt(Math.max(0, 1 - (qa * qa + qb * qb + qc * qc)));
        const mode = qA - 252;

        let qx, qy, qz, qw;
        switch (mode) {
            case 0:
                qx = qa;
                qy = qb;
                qz = qc;
                qw = qd;
                break;
            case 1:
                qx = qd;
                qy = qb;
                qz = qc;
                qw = qa;
                break;
            case 2:
                qx = qb;
                qy = qd;
                qz = qc;
                qw = qa;
                break;
            case 3:
                qx = qb;
                qy = qc;
                qz = qd;
                qw = qa;
                break;
            default:
                throw new Error(`SOG: invalid quaternion mode ${mode} at gaussian ${i}`);
        }

        const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
        rotations[i * 4 + 0] = qx / qLen;
        rotations[i * 4 + 1] = qy / qLen;
        rotations[i * 4 + 2] = qz / qLen;
        rotations[i * 4 + 3] = qw / qLen;

        // --- Scales ---
        // codebook pre-exp'd above
        const [sR, sG, sB] = getPixel(scalesImg, i);
        scales[i * 4 + 0] = scalesCodebook[sR];
        scales[i * 4 + 1] = scalesCodebook[sG];
        scales[i * 4 + 2] = scalesCodebook[sB];
        scales[i * 4 + 3] = 0;

        // --- SH0 / Colors + Opacity ---
        // codebook[idx] = SH DC coefficient; display = 0.5 + SH_C0 * coeff
        // opacity = alpha / 255 directly (verified: no sigmoid in engine)
        const [sh0R, sh0G, sh0B, sh0A] = getPixel(sh0Img, i);
        colors[i * 4 + 0] = 0.5 + SH_C0 * sh0Codebook[sh0R];
        colors[i * 4 + 1] = 0.5 + SH_C0 * sh0Codebook[sh0G];
        colors[i * 4 + 2] = 0.5 + SH_C0 * sh0Codebook[sh0B];
        colors[i * 4 + 3] = sh0A / 255;
    }

    return { count, positions, colors, rotations, scales, sh: null };
}

/**
 * Decode an unbundled SOG from a meta.json URL.
 * Fetches the meta.json and all referenced WebP images relative to the base URL.
 *
 * @param {string} metaUrl  URL ending in `meta.json`
 * @returns {Promise<import('../SplatLoader.js').SplatData>}
 */
export async function decodeSogUnbundled(metaUrl) {
    const base = metaUrl.slice(0, metaUrl.lastIndexOf('/') + 1);

    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error(`SOG: failed to fetch meta.json: ${metaRes.status}`);
    const meta = await metaRes.json();

    if (meta.version !== 2) {
        throw new Error(`SOG: only version 2 is supported, got version ${meta.version}`);
    }

    // Collect all referenced WebP filenames
    const allFiles = new Set();
    const addFiles = (field) => {
        if (!field) return;
        const files = field.files;
        if (!files) return;
        (Array.isArray(files) ? files : Object.values(files)).flat().forEach((f) => {
            if (typeof f === 'string' && f.endsWith('.webp')) allFiles.add(f);
        });
    };
    addFiles(meta.means);
    addFiles(meta.quats);
    addFiles(meta.scales);
    addFiles(meta.sh0);
    if (meta.shN) addFiles(meta.shN);

    // Fetch all images in parallel
    const imageMap = new Map();
    await Promise.all(
        [...allFiles].map(async (filename) => {
            const res = await fetch(base + filename);
            if (!res.ok) throw new Error(`SOG: failed to fetch "${filename}": ${res.status}`);
            const ab = await res.arrayBuffer();
            imageMap.set(filename, new Uint8Array(ab));
        })
    );

    return decodeSog(null, { meta, imageMap });
}
