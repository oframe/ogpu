// WebGPU texel-block geometry per format: { blockW, blockH, blockBytes }.
// Uncompressed formats are 1x1 blocks sized by bytes-per-texel; block-compressed
// formats are 4x4 (the only ones we transcode Basis into) sized by bytes-per-block.
// Used to compute `bytesPerRow`/`rowsPerImage` for writeTexture on compressed mips.
const BLOCK_INFO = {
    // block-compressed (4x4)
    'bc1-rgba-unorm': [4, 4, 8],
    'bc4-r-unorm': [4, 4, 8],
    'bc2-rgba-unorm': [4, 4, 16],
    'bc3-rgba-unorm': [4, 4, 16],
    'bc5-rg-unorm': [4, 4, 16],
    'bc6h-rgb-ufloat': [4, 4, 16],
    'bc6h-rgb-float': [4, 4, 16],
    'bc7-rgba-unorm': [4, 4, 16],
    'bc7-rgba-unorm-srgb': [4, 4, 16],
    'etc2-rgb8unorm': [4, 4, 8],
    'etc2-rgba8unorm': [4, 4, 16],
    'astc-4x4-unorm': [4, 4, 16],
    'astc-4x4-unorm-srgb': [4, 4, 16],
    // uncompressed (1x1) — the formats KTX loaders actually produce
    rgba8unorm: [1, 1, 4],
    'rgba8unorm-srgb': [1, 1, 4],
    bgra8unorm: [1, 1, 4],
    'bgra8unorm-srgb': [1, 1, 4],
    rgba16float: [1, 1, 8],
    rgba16unorm: [1, 1, 8],
    rgba32float: [1, 1, 16],
};

// Returns { blockW, blockH, blockBytes } for a WebGPU format, or null if unknown.
export const formatBlockInfo = (format) => {
    const e = BLOCK_INFO[format];
    return e ? { blockW: e[0], blockH: e[1], blockBytes: e[2] } : null;
};

export const parseKTXHeader = (u8) => {
    const isKTX2 = u8[4] === 0x20 && u8[5] === 0x32 && u8[6] === 0x30; // " 20"
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    if (isKTX2) {
        const vkFormat = dv.getUint32(12, true);
        const width = dv.getUint32(20, true);
        const height = dv.getUint32(24, true);
        const faces = dv.getUint32(36, true) || 1;
        const levels = dv.getUint32(40, true) || 1;

        const isSRGB = isVkFormatSRGB(vkFormat);
        const is16Bit = isVkFormat16Bit(vkFormat);
        const format = vkFormatToWebGPU(vkFormat);
        return { kind: 'ktx2', width, height, faces, levels, vkFormat, isSRGB, is16Bit, format };
    } else {
        const glInternalFormat = dv.getUint32(28, true);
        const width = dv.getUint32(36, true);
        const height = dv.getUint32(40, true);
        const faces = dv.getUint32(52, true) || 1;
        const levels = dv.getUint32(56, true) || 1;

        const isSRGB = isGLInternalFormatSRGB(glInternalFormat);
        const is16Bit = isGLFormat16Bit(glInternalFormat);
        const format = glFormatToWebGPU(glInternalFormat);
        return {
            kind: 'ktx1',
            width,
            height,
            faces,
            levels,
            glInternalFormat,
            isSRGB,
            is16Bit,
            format,
        };
    }
};

// ---- Helpers ----

// VK format → WebGPU format string. Returns null for unsupported/unknown formats.
const VK_TO_WEBGPU = {
    // 8-bit
    37: 'rgba8unorm', // VK_FORMAT_R8G8B8A8_UNORM
    43: 'rgba8unorm-srgb', // VK_FORMAT_R8G8B8A8_SRGB
    44: 'bgra8unorm', // VK_FORMAT_B8G8R8A8_UNORM
    50: 'bgra8unorm-srgb', // VK_FORMAT_B8G8R8A8_SRGB
    // 16-bit unorm (requires "norm16-texture-formats" feature)
    70: 'r16unorm', // VK_FORMAT_R16_UNORM
    77: 'rg16unorm', // VK_FORMAT_R16G16_UNORM
    91: 'rgba16unorm', // VK_FORMAT_R16G16B16A16_UNORM
    // 16-bit uint
    74: 'r16uint', // VK_FORMAT_R16_UINT
    81: 'rg16uint', // VK_FORMAT_R16G16_UINT
    95: 'rgba16uint', // VK_FORMAT_R16G16B16A16_UINT
    // 16-bit sint
    75: 'r16sint', // VK_FORMAT_R16_SINT
    82: 'rg16sint', // VK_FORMAT_R16G16_SINT
    96: 'rgba16sint', // VK_FORMAT_R16G16B16A16_SINT
    // 16-bit float
    76: 'r16float', // VK_FORMAT_R16_SFLOAT
    83: 'rg16float', // VK_FORMAT_R16G16_SFLOAT
    97: 'rgba16float', // VK_FORMAT_R16G16B16A16_SFLOAT
    // 32-bit float
    100: 'r32float', // VK_FORMAT_R32_SFLOAT
    103: 'rg32float', // VK_FORMAT_R32G32_SFLOAT
    109: 'rgba32float', // VK_FORMAT_R32G32B32A32_SFLOAT
    // packed
    122: 'rg11b10ufloat', // VK_FORMAT_B10G11R11_UFLOAT_PACK32
    // depth/stencil
    124: 'depth16unorm', // VK_FORMAT_D16_UNORM
    126: 'depth24plus', // VK_FORMAT_X8_D24_UNORM_PACK32
    130: 'depth32float', // VK_FORMAT_D32_SFLOAT
    // BC compressed
    131: 'bc1-rgba-unorm', // VK_FORMAT_BC1_RGBA_UNORM_BLOCK
    133: 'bc2-rgba-unorm', // VK_FORMAT_BC2_UNORM_BLOCK
    135: 'bc3-rgba-unorm', // VK_FORMAT_BC3_UNORM_BLOCK
    137: 'bc4-r-unorm', // VK_FORMAT_BC4_UNORM_BLOCK
    139: 'bc5-rg-unorm', // VK_FORMAT_BC5_UNORM_BLOCK
    141: 'bc6h-rgb-ufloat', // VK_FORMAT_BC6H_UFLOAT_BLOCK
    142: 'bc6h-rgb-float', // VK_FORMAT_BC6H_SFLOAT_BLOCK
    143: 'bc7-rgba-unorm', // VK_FORMAT_BC7_UNORM_BLOCK
    144: 'bc7-rgba-unorm-srgb', // VK_FORMAT_BC7_SRGB_BLOCK
    // ETC2
    147: 'etc2-rgb8unorm', // VK_FORMAT_ETC2_R8G8B8_UNORM_BLOCK
    149: 'etc2-rgba8unorm', // VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK
};

export const vkFormatToWebGPU = (fmt) => VK_TO_WEBGPU[fmt] ?? null;

// GL internal format → WebGPU format string.
const GL_TO_WEBGPU = {
    // 8-bit
    0x8058: 'rgba8unorm', // GL_RGBA8
    0x8c43: 'rgba8unorm-srgb', // GL_SRGB8_ALPHA8 (also covers GL_SRGB_ALPHA)
    0x8c44: 'rgba8unorm-srgb', // GL_SRGB8_ALPHA8
    // 16-bit float
    0x822d: 'r16float', // GL_R16F
    0x822f: 'rg16float', // GL_RG16F
    0x881a: 'rgba16float', // GL_RGBA16F
    // 16-bit uint
    0x8234: 'r16uint', // GL_R16UI
    0x823a: 'rg16uint', // GL_RG16UI
    0x8d76: 'rgba16uint', // GL_RGBA16UI
    // 16-bit sint
    0x8235: 'r16sint', // GL_R16I
    0x823b: 'rg16sint', // GL_RG16I
    0x8d88: 'rgba16sint', // GL_RGBA16I
    // 32-bit float
    0x822e: 'r32float', // GL_R32F
    0x8230: 'rg32float', // GL_RG32F
    0x8814: 'rgba32float', // GL_RGBA32F
    // depth
    0x81a5: 'depth16unorm', // GL_DEPTH_COMPONENT16
    0x81a6: 'depth24plus', // GL_DEPTH_COMPONENT24
    0x8cac: 'depth32float', // GL_DEPTH_COMPONENT32F
    // S3TC / DXT (WebGPU has no bc1-rgb, so DXT1 RGB samples as bc1-rgba, alpha=1)
    0x83f0: 'bc1-rgba-unorm', // GL_COMPRESSED_RGB_S3TC_DXT1_EXT
    0x83f1: 'bc1-rgba-unorm', // GL_COMPRESSED_RGBA_S3TC_DXT1_EXT
    0x83f2: 'bc2-rgba-unorm', // GL_COMPRESSED_RGBA_S3TC_DXT3_EXT
    0x83f3: 'bc3-rgba-unorm', // GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
    // ETC2
    0x9274: 'etc2-rgb8unorm', // GL_COMPRESSED_RGB8_ETC2
    0x9278: 'etc2-rgba8unorm', // GL_COMPRESSED_RGBA8_ETC2_EAC
    // ASTC
    0x93b0: 'astc-4x4-unorm', // GL_COMPRESSED_RGBA_ASTC_4x4_KHR
};

export const glFormatToWebGPU = (fmt) => GL_TO_WEBGPU[fmt] ?? null;

// 16-bit VK format range: R16_UNORM(70) … R16G16B16A16_SFLOAT(97)
const isVkFormat16Bit = (fmt) => fmt >= 70 && fmt <= 97;

// 16-bit GL formats
const GL_16BIT = new Set([
    0x822d,
    0x822f,
    0x881a, // float
    0x8234,
    0x823a,
    0x8d76, // uint
    0x8235,
    0x823b,
    0x8d88, // sint
]);
const isGLFormat16Bit = (fmt) => GL_16BIT.has(fmt);

const isVkFormatSRGB = (fmt) => {
    const sRGBFormats = new Set([
        43, // VK_FORMAT_R8G8B8A8_SRGB
        50, // VK_FORMAT_B8G8R8A8_SRGB
        129, // VK_FORMAT_BC1_RGB_SRGB_BLOCK
        131, // VK_FORMAT_BC1_RGBA_SRGB_BLOCK
        133, // VK_FORMAT_BC2_SRGB_BLOCK
        135, // VK_FORMAT_BC3_SRGB_BLOCK
        144, // VK_FORMAT_BC7_SRGB_BLOCK
        148, // VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK
        150, // VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK
    ]);
    return sRGBFormats.has(fmt);
};

const isGLInternalFormatSRGB = (fmt) => {
    const sRGBFormats = new Set([
        0x8c41, // GL_SRGB
        0x8c43, // GL_SRGB_ALPHA
        0x8c42, // GL_SRGB8
        0x8c44, // GL_SRGB8_ALPHA8
        0x8c4c, // GL_COMPRESSED_SRGB
        0x8c4d, // GL_COMPRESSED_SRGB_ALPHA
        0x8c4e, // GL_COMPRESSED_SRGB_S3TC_DXT1_EXT
        0x8c4f, // GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT
        0x8c50, // GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT
        0x8c51, // GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
    ]);
    return sRGBFormats.has(fmt);
};
