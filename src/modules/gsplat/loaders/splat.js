/**
 * antimatter15 .splat format loader.
 *
 * Binary, no header, 32 bytes per gaussian:
 *   float32x3  position
 *   float32x3  scale (already linear)
 *   uint8x4    rgba  (display color 0–255 + opacity 0–255, divide by 255, no SH/sigmoid math)
 *   uint8x4    rotation bytes [w, x, y, z]: component = (byte − 128) / 128 → normalize → [x,y,z,w]
 */

const SPLAT_STRIDE = 32;

/**
 * Decode an antimatter15 .splat ArrayBuffer into SplatData.
 * @param {ArrayBuffer} buffer
 * @returns {import('../SplatLoader.js').SplatData}
 */
export function decodeSplat(buffer) {
    if (buffer.byteLength % SPLAT_STRIDE !== 0) {
        throw new Error(`.splat: buffer length ${buffer.byteLength} is not a multiple of stride ${SPLAT_STRIDE}`);
    }
    const count = buffer.byteLength / SPLAT_STRIDE;

    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 4);

    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    for (let i = 0; i < count; i++) {
        const byteBase = i * SPLAT_STRIDE;

        // Positions (3 × float32)
        positions[i * 4 + 0] = dv.getFloat32(byteBase + 0, true);
        positions[i * 4 + 1] = dv.getFloat32(byteBase + 4, true);
        positions[i * 4 + 2] = dv.getFloat32(byteBase + 8, true);
        positions[i * 4 + 3] = 0;

        // Scale (3 × float32, already linear)
        scales[i * 4 + 0] = dv.getFloat32(byteBase + 12, true);
        scales[i * 4 + 1] = dv.getFloat32(byteBase + 16, true);
        scales[i * 4 + 2] = dv.getFloat32(byteBase + 20, true);
        scales[i * 4 + 3] = 0;

        // Color/opacity: 4 × uint8 RGBA, already display values
        colors[i * 4 + 0] = u8[byteBase + 24] / 255;
        colors[i * 4 + 1] = u8[byteBase + 25] / 255;
        colors[i * 4 + 2] = u8[byteBase + 26] / 255;
        colors[i * 4 + 3] = u8[byteBase + 27] / 255;

        // Rotation: bytes [w, x, y, z] order, component = (byte − 128) / 128 → normalize → [x,y,z,w]
        const rw = (u8[byteBase + 28] - 128) / 128;
        const rx = (u8[byteBase + 29] - 128) / 128;
        const ry = (u8[byteBase + 30] - 128) / 128;
        const rz = (u8[byteBase + 31] - 128) / 128;
        const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
        rotations[i * 4 + 0] = rx / rLen;
        rotations[i * 4 + 1] = ry / rLen;
        rotations[i * 4 + 2] = rz / rLen;
        rotations[i * 4 + 3] = rw / rLen;
    }

    return { count, positions, colors, rotations, scales, sh: null };
}
