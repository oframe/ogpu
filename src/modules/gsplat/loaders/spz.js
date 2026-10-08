/**
 * Niantic .spz format loader — versions 1–3 only (v4+ uses zstd, unsupported).
 *
 * The file is gzip-compressed. Decompress with DecompressionStream('gzip').
 * If the first 4 bytes already equal the SPZ magic (0x5053474e LE "NGSP"),
 * the payload is assumed to be uncompressed and used as-is.
 *
 * 16-byte header:
 *   uint32 magic        = 0x5053474e
 *   uint32 version      (1–3)
 *   uint32 numPoints
 *   uint8  shDegree
 *   uint8  fractionalBits
 *   uint8  flags
 *   uint8  reserved
 *
 * Attribute sections follow in order:
 *   positions   3 × 24-bit signed fixed-point per gaussian
 *   alphas      1 byte per gaussian (already sigmoid-applied)
 *   colors      3 bytes rgb per gaussian
 *   scales      3 bytes per gaussian (log-encoded: linear = exp(byte/16 − 10))
 *   rotations   v1/v2: 3 bytes xyz quat components; v3: 4 bytes smallest-three
 *   sh          (shDegree>0) skipped but accounted for in buffer length check
 *
 * ─── Credits & sources ───────────────────────────────────────────────────────
 * SPZ format by Niantic.
 *   - Format + reference decoder: https://github.com/nianticlabs/spz
 *                                 src/cc/load-spz.cc
 *                                 (header layout, 24-bit fixed-point positions,
 *                                  color/scale encoding, and v3 smallest-three
 *                                  quaternion bit order verified against this file)
 *   - Announcement:  https://nianticlabs.com/news/spz-gaussian-splat-open-source-file-format
 *
 * Original 3D Gaussian Splatting (SH_C0 DC term, opacity/scale encoding):
 *   Kerbl, Kopanas, Leimkühler, Drettakis — "3D Gaussian Splatting for
 *   Real-Time Radiance Field Rendering", SIGGRAPH 2023.
 *   - https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
 *   - https://github.com/graphdeco-inria/gaussian-splatting
 */

const SPZ_MAGIC = 0x5053474e; // "NGSP" little-endian
const SH_C0 = 0.28209479177387814;

/** Number of SH coefficients per channel for a given degree (excluding DC). */
function shCoeffCount(degree) {
    // degree 0 → 0 extra, 1 → 3, 2 → 8, 3 → 15
    if (degree === 0) return 0;
    if (degree === 1) return 3;
    if (degree === 2) return 8;
    return 15;
}

/**
 * Decompress a gzip stream to ArrayBuffer using DecompressionStream.
 * @param {ArrayBuffer} compressed
 * @returns {Promise<ArrayBuffer>}
 */
async function gunzip(compressed) {
    // pipeThrough, not writer.write/close: those promises reject unobserved on corrupt input
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

/**
 * Decode a Niantic .spz ArrayBuffer into SplatData.
 * @param {ArrayBuffer} buffer  Raw file bytes (may be gzip-compressed).
 * @returns {Promise<import('../SplatLoader.js').SplatData>}
 */
export async function decodeSpz(buffer) {
    // Detect gzip vs raw
    const peek = new Uint8Array(buffer, 0, 4);
    const isGzip = peek[0] === 0x1f && peek[1] === 0x8b;
    const isRaw = peek[0] === (SPZ_MAGIC & 0xff) && peek[1] === ((SPZ_MAGIC >> 8) & 0xff) && peek[2] === ((SPZ_MAGIC >> 16) & 0xff) && peek[3] === ((SPZ_MAGIC >> 24) & 0xff);

    let raw;
    if (isRaw) {
        raw = buffer;
    } else if (isGzip) {
        raw = await gunzip(buffer);
    } else {
        // Try gunzip anyway as a fallback
        try {
            raw = await gunzip(buffer);
        } catch {
            throw new Error('SPZ: unrecognised file — not gzip and not SPZ magic');
        }
    }

    const dv = new DataView(raw);

    // Validate magic
    const magic = dv.getUint32(0, true);
    if (magic !== SPZ_MAGIC) {
        throw new Error(`SPZ: bad magic 0x${magic.toString(16).padStart(8, '0')}, expected 0x${SPZ_MAGIC.toString(16)}`);
    }

    const version = dv.getUint32(4, true);
    if (version > 3) {
        throw new Error(`SPZ: version ${version} is not supported (zstd compression in v4+ is not implemented)`);
    }

    const count = dv.getUint32(8, true);
    const shDegree = dv.getUint8(12);
    const fractionalBits = dv.getUint8(13);
    // flags and reserved at bytes 14–15 are unused in v1–3

    const scale = 1.0 / (1 << fractionalBits);

    // Compute expected section sizes
    const posBytes = count * 9; // 3 × 3-byte fixed-point
    const alphaBytes = count; // 1 byte
    const colorBytes = count * 3; // 3 bytes rgb
    const scaleBytes = count * 3; // 3 bytes
    const rotBytesPerPoint = version >= 3 ? 4 : 3;
    const rotBytes = count * rotBytesPerPoint;
    const shCoeffs = shCoeffCount(shDegree);
    const shBytes = count * shCoeffs * 3; // 3 channels

    const totalExpected = 16 + posBytes + alphaBytes + colorBytes + scaleBytes + rotBytes + shBytes;
    if (raw.byteLength < totalExpected) {
        throw new Error(`SPZ: buffer too small — expected at least ${totalExpected} bytes for ${count} gaussians, got ${raw.byteLength}`);
    }

    // Section byte offsets
    let off = 16;
    const offPos = off;
    off += posBytes;
    const offAlpha = off;
    off += alphaBytes;
    const offColor = off;
    off += colorBytes;
    const offScale = off;
    off += scaleBytes;
    const offRot = off;

    const u8 = new Uint8Array(raw);

    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        // --- Positions: 3 × 24-bit signed fixed-point ---
        const pb = offPos + i * 9;

        let fx = u8[pb + 0] | (u8[pb + 1] << 8) | (u8[pb + 2] << 16);
        let fy = u8[pb + 3] | (u8[pb + 4] << 8) | (u8[pb + 5] << 16);
        let fz = u8[pb + 6] | (u8[pb + 7] << 8) | (u8[pb + 8] << 16);

        // Sign-extend bit 23
        if (fx & 0x800000) fx = fx | 0xff000000 | 0;
        else fx = fx | 0;
        if (fy & 0x800000) fy = fy | 0xff000000 | 0;
        else fy = fy | 0;
        if (fz & 0x800000) fz = fz | 0xff000000 | 0;
        else fz = fz | 0;

        positions[i * 4 + 0] = fx * scale;
        positions[i * 4 + 1] = fy * scale;
        positions[i * 4 + 2] = fz * scale;
        positions[i * 4 + 3] = 0;

        // --- Alpha: already sigmoid-applied ---
        colors[i * 4 + 3] = u8[offAlpha + i] / 255;

        // --- Colors: file stores (colorCoeff * 0.15 + 0.5) * 255 ---
        // Recover display color: 0.5 + SH_C0 * ((byte/255 - 0.5) / 0.15)
        const cb = offColor + i * 3;
        const cr = u8[cb + 0] / 255;
        const cg = u8[cb + 1] / 255;
        const cb2 = u8[cb + 2] / 255;
        colors[i * 4 + 0] = 0.5 + SH_C0 * ((cr - 0.5) / 0.15);
        colors[i * 4 + 1] = 0.5 + SH_C0 * ((cg - 0.5) / 0.15);
        colors[i * 4 + 2] = 0.5 + SH_C0 * ((cb2 - 0.5) / 0.15);

        // --- Scales: log-encoded → linear = exp(byte/16 − 10) ---
        const sb = offScale + i * 3;
        scales[i * 4 + 0] = Math.exp(u8[sb + 0] / 16 - 10);
        scales[i * 4 + 1] = Math.exp(u8[sb + 1] / 16 - 10);
        scales[i * 4 + 2] = Math.exp(u8[sb + 2] / 16 - 10);
        scales[i * 4 + 3] = 0;

        // --- Rotations ---
        const rb = offRot + i * rotBytesPerPoint;

        if (version >= 3) {
            // Smallest-three encoding: 4 bytes packed
            const comp = (u8[rb + 0] | (u8[rb + 1] << 8) | (u8[rb + 2] << 16) | (u8[rb + 3] << 24)) >>> 0;

            const iLargest = comp >>> 30;
            let remaining = comp & 0x3fffffff; // mask out top 2 bits

            const q = [0, 0, 0, 0];
            let sumSq = 0;

            // Decode the 3 smallest components. Each uses 10 bits:
            // bit 9 = sign, bits 8–0 = magnitude. The reference decoder
            // (nianticlabs/spz load-spz.cc) iterates component index 3 → 0,
            // skipping iLargest, consuming the LOW 10 bits first each time —
            // so the highest non-largest component index sits in the lowest bits.
            for (let j = 3; j >= 0; j--) {
                if (j === iLargest) continue;
                const mag = remaining & 0x1ff;
                const neg = (remaining >>> 9) & 1;
                remaining >>>= 10;
                const val = (Math.SQRT1_2 * mag) / 511;
                q[j] = neg ? -val : val;
                sumSq += val * val;
            }
            q[iLargest] = Math.sqrt(Math.max(0, 1 - sumSq));

            // q is [x, y, z, w]
            const qLen = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
            rotations[i * 4 + 0] = q[0] / qLen;
            rotations[i * 4 + 1] = q[1] / qLen;
            rotations[i * 4 + 2] = q[2] / qLen;
            rotations[i * 4 + 3] = q[3] / qLen;
        } else {
            // v1/v2: 3 bytes xyz, derive w
            const qx = u8[rb + 0] / 127.5 - 1;
            const qy = u8[rb + 1] / 127.5 - 1;
            const qz = u8[rb + 2] / 127.5 - 1;
            const qw = Math.sqrt(Math.max(0, 1 - (qx * qx + qy * qy + qz * qz)));
            const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
            rotations[i * 4 + 0] = qx / qLen;
            rotations[i * 4 + 1] = qy / qLen;
            rotations[i * 4 + 2] = qz / qLen;
            rotations[i * 4 + 3] = qw / qLen;
        }
    }

    return { count, positions, colors, rotations, scales, sh: null };
}
