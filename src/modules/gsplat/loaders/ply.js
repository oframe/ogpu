/**
 * INRIA binary little-endian PLY loader for Gaussian Splats.
 *
 * Property byte offsets are derived generically from the header so the loader
 * is robust to missing f_rest_* SH columns or any additional unknown columns.
 */

const SH_C0 = 0.28209479177387814;

/**
 * Parse the ASCII PLY header up to and including the `end_header` line.
 * Returns { byteOffset, stride, props } where `props` is a map of
 * property name → byte offset within each vertex record.
 *
 * @param {Uint8Array} bytes
 * @returns {{ headerBytes: number, count: number, stride: number, props: Map<string,number> }}
 */
function parsePlyHeader(bytes) {
    const decoder = new TextDecoder('ascii');

    // Find `end_header\n` in the byte stream (search up to first 32 kB).
    const scan = bytes.subarray(0, Math.min(bytes.length, 32768));
    const text = decoder.decode(scan);

    const endIdx = text.indexOf('end_header\n');
    if (endIdx === -1) throw new Error('PLY: end_header not found');
    const headerText = text.slice(0, endIdx + 'end_header\n'.length);
    const headerBytes = new TextEncoder().encode(headerText).length;

    if (!headerText.startsWith('ply\n')) throw new Error('PLY: missing magic "ply\\n"');
    if (!headerText.includes('format binary_little_endian')) {
        throw new Error('PLY: only binary_little_endian format is supported');
    }

    // Parse vertex count
    const countMatch = headerText.match(/element vertex (\d+)/);
    if (!countMatch) throw new Error('PLY: element vertex not found in header');
    const count = parseInt(countMatch[1], 10);

    // Parse property list in order — currently only float32 properties are used.
    const props = new Map();
    let byteOff = 0;
    let stride = 0;
    for (const line of headerText.split('\n')) {
        const m = line.trim().match(/^property (\S+) (\S+)$/);
        if (!m) continue;
        const [, dtype, name] = m;
        const size = dtypeSize(dtype);
        props.set(name, { offset: byteOff, dtype, size });
        byteOff += size;
    }
    stride = byteOff;

    return { headerBytes, count, stride, props };
}

function dtypeSize(dtype) {
    switch (dtype) {
        case 'float':
        case 'float32':
        case 'int':
        case 'int32':
        case 'uint':
        case 'uint32':
            return 4;
        case 'short':
        case 'int16':
        case 'uint16':
        case 'ushort':
            return 2;
        case 'uchar':
        case 'uint8':
        case 'char':
        case 'int8':
            return 1;
        case 'double':
        case 'float64':
        case 'int64':
        case 'uint64':
            return 8;
        default:
            throw new Error(`PLY: unknown property dtype "${dtype}"`);
    }
}

/**
 * Read a float32 at the given absolute byte offset in a DataView.
 * @param {DataView} dv
 * @param {number} base  Start of the vertex record.
 * @param {Map} props
 * @param {string} name
 * @param {number} [fallback=0]
 * @returns {number}
 */
function readF32(dv, base, props, name, fallback = 0) {
    const p = props.get(name);
    if (!p) return fallback;
    return dv.getFloat32(base + p.offset, true);
}

/**
 * Decode a binary little-endian PLY ArrayBuffer into SplatData.
 * @param {ArrayBuffer} buffer
 * @returns {import('../SplatLoader.js').SplatData}
 */
export function decodePly(buffer) {
    const bytes = new Uint8Array(buffer);
    const { headerBytes, count, stride, props } = parsePlyHeader(bytes);

    const dataBytes = buffer.byteLength - headerBytes;
    const expected = count * stride;
    if (dataBytes < expected) {
        throw new Error(`PLY: buffer too small — expected ${expected} data bytes for ${count} gaussians ` + `(stride ${stride}), got ${dataBytes}`);
    }

    const dv = new DataView(buffer, headerBytes);

    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        const base = i * stride;

        // Positions
        positions[i * 4 + 0] = readF32(dv, base, props, 'x');
        positions[i * 4 + 1] = readF32(dv, base, props, 'y');
        positions[i * 4 + 2] = readF32(dv, base, props, 'z');
        positions[i * 4 + 3] = 0;

        // Colors: display = 0.5 + SH_C0 * f_dc_i
        const fdc0 = readF32(dv, base, props, 'f_dc_0');
        const fdc1 = readF32(dv, base, props, 'f_dc_1');
        const fdc2 = readF32(dv, base, props, 'f_dc_2');
        colors[i * 4 + 0] = 0.5 + SH_C0 * fdc0;
        colors[i * 4 + 1] = 0.5 + SH_C0 * fdc1;
        colors[i * 4 + 2] = 0.5 + SH_C0 * fdc2;

        // Opacity: sigmoid(raw)
        const opacityRaw = readF32(dv, base, props, 'opacity', 0);
        colors[i * 4 + 3] = 1.0 / (1.0 + Math.exp(-opacityRaw));

        // Scales: exp(log-scale)
        scales[i * 4 + 0] = Math.exp(readF32(dv, base, props, 'scale_0', 0));
        scales[i * 4 + 1] = Math.exp(readF32(dv, base, props, 'scale_1', 0));
        scales[i * 4 + 2] = Math.exp(readF32(dv, base, props, 'scale_2', 0));
        scales[i * 4 + 3] = 0;

        // Rotation: PLY stores [rot_0=w, rot_1=x, rot_2=y, rot_3=z] → normalize → [x,y,z,w]
        const rw = readF32(dv, base, props, 'rot_0', 1);
        const rx = readF32(dv, base, props, 'rot_1', 0);
        const ry = readF32(dv, base, props, 'rot_2', 0);
        const rz = readF32(dv, base, props, 'rot_3', 0);
        const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
        rotations[i * 4 + 0] = rx / rLen;
        rotations[i * 4 + 1] = ry / rLen;
        rotations[i * 4 + 2] = rz / rLen;
        rotations[i * 4 + 3] = rw / rLen;
    }

    return { count, positions, colors, rotations, scales, sh: null };
}
