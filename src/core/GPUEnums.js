// Named constants for the WebGPU string enums, so descriptors read
// `TextureFormat.RGBA16FLOAT` instead of a bare `'rgba16float'` literal. Values
// are the exact spec strings (W3C WebGPU IDL) — pass them straight to WebGPU.
//
// Key convention: the spec string, uppercased, with `-` → `_`
// ('one-minus-src-alpha' → ONE_MINUS_SRC_ALPHA). Dimension keys carry a `D`
// prefix because a JS identifier can't start with a digit ('2d-array' → D2_ARRAY).
//
// Covers every IDL `enum GPU*` type. The bitflag namespaces (GPUBufferUsage,
// GPUTextureUsage, GPUShaderStage, GPUColorWrite, GPUMapMode) are NOT here —
// they're numeric-flag globals the platform already exposes (`GPUBufferUsage.VERTEX`).
//
// Object.freeze locks each table: a stray `TextureFormat.RGBA16FLOAT = ...` write
// throws instead of silently corrupting a shared constant.
//
// Data tables keyed BY a format string (Texture.js byte-size switch, ktxutils
// VK/GL maps) intentionally keep raw strings; they're lookups, not declarations.

// ═══════════════════════════════ TEXTURE FORMATS ═══════════════════════════════
// GPUTextureFormat
export const TextureFormat = Object.freeze({
    // 8-bit
    R8UNORM: 'r8unorm',
    R8SNORM: 'r8snorm',
    R8UINT: 'r8uint',
    R8SINT: 'r8sint',
    // 16-bit
    R16UNORM: 'r16unorm',
    R16SNORM: 'r16snorm',
    R16UINT: 'r16uint',
    R16SINT: 'r16sint',
    R16FLOAT: 'r16float',
    RG8UNORM: 'rg8unorm',
    RG8SNORM: 'rg8snorm',
    RG8UINT: 'rg8uint',
    RG8SINT: 'rg8sint',
    // 32-bit
    R32UINT: 'r32uint',
    R32SINT: 'r32sint',
    R32FLOAT: 'r32float',
    RG16UNORM: 'rg16unorm',
    RG16SNORM: 'rg16snorm',
    RG16UINT: 'rg16uint',
    RG16SINT: 'rg16sint',
    RG16FLOAT: 'rg16float',
    RGBA8UNORM: 'rgba8unorm',
    RGBA8UNORM_SRGB: 'rgba8unorm-srgb',
    RGBA8SNORM: 'rgba8snorm',
    RGBA8UINT: 'rgba8uint',
    RGBA8SINT: 'rgba8sint',
    BGRA8UNORM: 'bgra8unorm',
    BGRA8UNORM_SRGB: 'bgra8unorm-srgb',
    // packed 32-bit
    RGB9E5UFLOAT: 'rgb9e5ufloat',
    RGB10A2UINT: 'rgb10a2uint',
    RGB10A2UNORM: 'rgb10a2unorm',
    RG11B10UFLOAT: 'rg11b10ufloat',
    // 64-bit
    RG32UINT: 'rg32uint',
    RG32SINT: 'rg32sint',
    RG32FLOAT: 'rg32float',
    RGBA16UNORM: 'rgba16unorm',
    RGBA16SNORM: 'rgba16snorm',
    RGBA16UINT: 'rgba16uint',
    RGBA16SINT: 'rgba16sint',
    RGBA16FLOAT: 'rgba16float',
    // 128-bit
    RGBA32UINT: 'rgba32uint',
    RGBA32SINT: 'rgba32sint',
    RGBA32FLOAT: 'rgba32float',
    // depth / stencil
    STENCIL8: 'stencil8',
    DEPTH16UNORM: 'depth16unorm',
    DEPTH24PLUS: 'depth24plus',
    DEPTH24PLUS_STENCIL8: 'depth24plus-stencil8',
    DEPTH32FLOAT: 'depth32float',
    DEPTH32FLOAT_STENCIL8: 'depth32float-stencil8', // feature: depth32float-stencil8
    // BC — feature: texture-compression-bc
    BC1_RGBA_UNORM: 'bc1-rgba-unorm',
    BC1_RGBA_UNORM_SRGB: 'bc1-rgba-unorm-srgb',
    BC2_RGBA_UNORM: 'bc2-rgba-unorm',
    BC2_RGBA_UNORM_SRGB: 'bc2-rgba-unorm-srgb',
    BC3_RGBA_UNORM: 'bc3-rgba-unorm',
    BC3_RGBA_UNORM_SRGB: 'bc3-rgba-unorm-srgb',
    BC4_R_UNORM: 'bc4-r-unorm',
    BC4_R_SNORM: 'bc4-r-snorm',
    BC5_RG_UNORM: 'bc5-rg-unorm',
    BC5_RG_SNORM: 'bc5-rg-snorm',
    BC6H_RGB_UFLOAT: 'bc6h-rgb-ufloat',
    BC6H_RGB_FLOAT: 'bc6h-rgb-float',
    BC7_RGBA_UNORM: 'bc7-rgba-unorm',
    BC7_RGBA_UNORM_SRGB: 'bc7-rgba-unorm-srgb',
    // ETC2 / EAC — feature: texture-compression-etc2
    ETC2_RGB8UNORM: 'etc2-rgb8unorm',
    ETC2_RGB8UNORM_SRGB: 'etc2-rgb8unorm-srgb',
    ETC2_RGB8A1UNORM: 'etc2-rgb8a1unorm',
    ETC2_RGB8A1UNORM_SRGB: 'etc2-rgb8a1unorm-srgb',
    ETC2_RGBA8UNORM: 'etc2-rgba8unorm',
    ETC2_RGBA8UNORM_SRGB: 'etc2-rgba8unorm-srgb',
    EAC_R11UNORM: 'eac-r11unorm',
    EAC_R11SNORM: 'eac-r11snorm',
    EAC_RG11UNORM: 'eac-rg11unorm',
    EAC_RG11SNORM: 'eac-rg11snorm',
    // ASTC — feature: texture-compression-astc
    ASTC_4X4_UNORM: 'astc-4x4-unorm',
    ASTC_4X4_UNORM_SRGB: 'astc-4x4-unorm-srgb',
    ASTC_5X4_UNORM: 'astc-5x4-unorm',
    ASTC_5X4_UNORM_SRGB: 'astc-5x4-unorm-srgb',
    ASTC_5X5_UNORM: 'astc-5x5-unorm',
    ASTC_5X5_UNORM_SRGB: 'astc-5x5-unorm-srgb',
    ASTC_6X5_UNORM: 'astc-6x5-unorm',
    ASTC_6X5_UNORM_SRGB: 'astc-6x5-unorm-srgb',
    ASTC_6X6_UNORM: 'astc-6x6-unorm',
    ASTC_6X6_UNORM_SRGB: 'astc-6x6-unorm-srgb',
    ASTC_8X5_UNORM: 'astc-8x5-unorm',
    ASTC_8X5_UNORM_SRGB: 'astc-8x5-unorm-srgb',
    ASTC_8X6_UNORM: 'astc-8x6-unorm',
    ASTC_8X6_UNORM_SRGB: 'astc-8x6-unorm-srgb',
    ASTC_8X8_UNORM: 'astc-8x8-unorm',
    ASTC_8X8_UNORM_SRGB: 'astc-8x8-unorm-srgb',
    ASTC_10X5_UNORM: 'astc-10x5-unorm',
    ASTC_10X5_UNORM_SRGB: 'astc-10x5-unorm-srgb',
    ASTC_10X6_UNORM: 'astc-10x6-unorm',
    ASTC_10X6_UNORM_SRGB: 'astc-10x6-unorm-srgb',
    ASTC_10X8_UNORM: 'astc-10x8-unorm',
    ASTC_10X8_UNORM_SRGB: 'astc-10x8-unorm-srgb',
    ASTC_10X10_UNORM: 'astc-10x10-unorm',
    ASTC_10X10_UNORM_SRGB: 'astc-10x10-unorm-srgb',
    ASTC_12X10_UNORM: 'astc-12x10-unorm',
    ASTC_12X10_UNORM_SRGB: 'astc-12x10-unorm-srgb',
    ASTC_12X12_UNORM: 'astc-12x12-unorm',
    ASTC_12X12_UNORM_SRGB: 'astc-12x12-unorm-srgb',
});

// ═══════════════════════════════ VERTEX FORMATS ═══════════════════════════════
// GPUVertexFormat
export const VertexFormat = Object.freeze({
    UINT8: 'uint8',
    UINT8X2: 'uint8x2',
    UINT8X4: 'uint8x4',
    SINT8: 'sint8',
    SINT8X2: 'sint8x2',
    SINT8X4: 'sint8x4',
    UNORM8: 'unorm8',
    UNORM8X2: 'unorm8x2',
    UNORM8X4: 'unorm8x4',
    SNORM8: 'snorm8',
    SNORM8X2: 'snorm8x2',
    SNORM8X4: 'snorm8x4',
    UINT16: 'uint16',
    UINT16X2: 'uint16x2',
    UINT16X4: 'uint16x4',
    SINT16: 'sint16',
    SINT16X2: 'sint16x2',
    SINT16X4: 'sint16x4',
    UNORM16: 'unorm16',
    UNORM16X2: 'unorm16x2',
    UNORM16X4: 'unorm16x4',
    SNORM16: 'snorm16',
    SNORM16X2: 'snorm16x2',
    SNORM16X4: 'snorm16x4',
    FLOAT16: 'float16',
    FLOAT16X2: 'float16x2',
    FLOAT16X4: 'float16x4',
    FLOAT32: 'float32',
    FLOAT32X2: 'float32x2',
    FLOAT32X3: 'float32x3',
    FLOAT32X4: 'float32x4',
    UINT32: 'uint32',
    UINT32X2: 'uint32x2',
    UINT32X3: 'uint32x3',
    UINT32X4: 'uint32x4',
    SINT32: 'sint32',
    SINT32X2: 'sint32x2',
    SINT32X3: 'sint32x3',
    SINT32X4: 'sint32x4',
    UNORM10_10_10_2: 'unorm10-10-10-2',
    UNORM8X4_BGRA: 'unorm8x4-bgra',
});

// ═══════════════════════════════ BLENDING MODES ═══════════════════════════════
// GPUCanvasAlphaMode
export const AlphaMode = Object.freeze({
    OPAQUE: 'opaque',
    PREMULTIPLIED: 'premultiplied',
});

// GPUBlendFactor (SRC1* need the dual-source-blending feature)
export const BlendFactor = Object.freeze({
    ZERO: 'zero',
    ONE: 'one',
    SRC: 'src',
    ONE_MINUS_SRC: 'one-minus-src',
    SRC_ALPHA: 'src-alpha',
    ONE_MINUS_SRC_ALPHA: 'one-minus-src-alpha',
    DST: 'dst',
    ONE_MINUS_DST: 'one-minus-dst',
    DST_ALPHA: 'dst-alpha',
    ONE_MINUS_DST_ALPHA: 'one-minus-dst-alpha',
    SRC_ALPHA_SATURATED: 'src-alpha-saturated',
    CONSTANT: 'constant',
    ONE_MINUS_CONSTANT: 'one-minus-constant',
    SRC1: 'src1',
    ONE_MINUS_SRC1: 'one-minus-src1',
    SRC1_ALPHA: 'src1-alpha',
    ONE_MINUS_SRC1_ALPHA: 'one-minus-src1-alpha',
});

// GPUBlendOperation
export const BlendOperation = Object.freeze({
    ADD: 'add',
    SUBTRACT: 'subtract',
    REVERSE_SUBTRACT: 'reverse-subtract',
    MIN: 'min',
    MAX: 'max',
});

// ═══════════════════════════ DEPTH / STENCIL STATE ═══════════════════════════
// GPUCompareFunction
export const CompareFunction = Object.freeze({
    NEVER: 'never',
    LESS: 'less',
    EQUAL: 'equal',
    LESS_EQUAL: 'less-equal',
    GREATER: 'greater',
    NOT_EQUAL: 'not-equal',
    GREATER_EQUAL: 'greater-equal',
    ALWAYS: 'always',
});

// GPUStencilOperation
export const StencilOperation = Object.freeze({
    KEEP: 'keep',
    ZERO: 'zero',
    REPLACE: 'replace',
    INVERT: 'invert',
    INCREMENT_CLAMP: 'increment-clamp',
    DECREMENT_CLAMP: 'decrement-clamp',
    INCREMENT_WRAP: 'increment-wrap',
    DECREMENT_WRAP: 'decrement-wrap',
});

// ═══════════════════════════ PRIMITIVE / RASTER STATE ════════════════════════
// GPUPrimitiveTopology
export const PrimitiveTopology = Object.freeze({
    POINT_LIST: 'point-list',
    LINE_LIST: 'line-list',
    LINE_STRIP: 'line-strip',
    TRIANGLE_LIST: 'triangle-list',
    TRIANGLE_STRIP: 'triangle-strip',
});

// GPUFrontFace
export const FrontFace = Object.freeze({ CCW: 'ccw', CW: 'cw' });

// GPUCullMode
export const CullMode = Object.freeze({ NONE: 'none', FRONT: 'front', BACK: 'back' });

// GPUIndexFormat
export const IndexFormat = Object.freeze({ UINT16: 'uint16', UINT32: 'uint32' });

// GPUVertexStepMode
export const VertexStepMode = Object.freeze({ VERTEX: 'vertex', INSTANCE: 'instance' });

// ═══════════════════════════════ RENDER PASS OPS ═══════════════════════════════
// GPULoadOp
export const LoadOp = Object.freeze({ LOAD: 'load', CLEAR: 'clear' });

// GPUStoreOp
export const StoreOp = Object.freeze({ STORE: 'store', DISCARD: 'discard' });

// ══════════════════════════════ SAMPLER STATE ══════════════════════════════
// GPUAddressMode
export const AddressMode = Object.freeze({
    CLAMP_TO_EDGE: 'clamp-to-edge',
    REPEAT: 'repeat',
    MIRROR_REPEAT: 'mirror-repeat',
});

// GPUFilterMode
export const FilterMode = Object.freeze({ NEAREST: 'nearest', LINEAR: 'linear' });

// GPUMipmapFilterMode
export const MipmapFilterMode = Object.freeze({ NEAREST: 'nearest', LINEAR: 'linear' });

// ══════════════════════ TEXTURE / VIEW GEOMETRY ══════════════════════
// GPUTextureDimension
export const TextureDimension = Object.freeze({ D1: '1d', D2: '2d', D3: '3d' });

// GPUTextureViewDimension
export const TextureViewDimension = Object.freeze({
    D1: '1d',
    D2: '2d',
    D2_ARRAY: '2d-array',
    CUBE: 'cube',
    CUBE_ARRAY: 'cube-array',
    D3: '3d',
});

// GPUTextureAspect
export const TextureAspect = Object.freeze({
    ALL: 'all',
    STENCIL_ONLY: 'stencil-only',
    DEPTH_ONLY: 'depth-only',
});

// ══════════════════════════ BIND GROUP LAYOUT TYPES ══════════════════════════
// GPUBufferBindingType
export const BufferBindingType = Object.freeze({
    UNIFORM: 'uniform',
    STORAGE: 'storage',
    READ_ONLY_STORAGE: 'read-only-storage',
});

// GPUSamplerBindingType
export const SamplerBindingType = Object.freeze({
    FILTERING: 'filtering',
    NON_FILTERING: 'non-filtering',
    COMPARISON: 'comparison',
});

// GPUTextureSampleType
export const TextureSampleType = Object.freeze({
    FLOAT: 'float',
    UNFILTERABLE_FLOAT: 'unfilterable-float',
    DEPTH: 'depth',
    SINT: 'sint',
    UINT: 'uint',
});

// GPUStorageTextureAccess
export const StorageTextureAccess = Object.freeze({
    WRITE_ONLY: 'write-only',
    READ_ONLY: 'read-only',
    READ_WRITE: 'read-write',
});

// GPUAutoLayoutMode
export const AutoLayoutMode = Object.freeze({ AUTO: 'auto' });

// ══════════════════════════════ CANVAS ══════════════════════════════
// GPUCanvasToneMappingMode
export const CanvasToneMappingMode = Object.freeze({
    STANDARD: 'standard',
    EXTENDED: 'extended',
});

// ══════════════════════════════ QUERIES ══════════════════════════════
// GPUQueryType
export const QueryType = Object.freeze({ OCCLUSION: 'occlusion', TIMESTAMP: 'timestamp' });

// ══════════════════════════ ADAPTER / DEVICE ══════════════════════════
// GPUPowerPreference
export const PowerPreference = Object.freeze({
    LOW_POWER: 'low-power',
    HIGH_PERFORMANCE: 'high-performance',
});

// GPUBufferMapState
export const BufferMapState = Object.freeze({
    UNMAPPED: 'unmapped',
    PENDING: 'pending',
    MAPPED: 'mapped',
});

// GPUDeviceLostReason
export const DeviceLostReason = Object.freeze({ UNKNOWN: 'unknown', DESTROYED: 'destroyed' });

// ══════════════════════════ ERROR / DIAGNOSTICS ══════════════════════════
// GPUErrorFilter
export const ErrorFilter = Object.freeze({
    VALIDATION: 'validation',
    OUT_OF_MEMORY: 'out-of-memory',
    INTERNAL: 'internal',
});

// GPUCompilationMessageType
export const CompilationMessageType = Object.freeze({
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info',
});

// GPUPipelineErrorReason
export const PipelineErrorReason = Object.freeze({
    VALIDATION: 'validation',
    INTERNAL: 'internal',
});

// ══════════════════════════════ FEATURES ══════════════════════════════
// GPUFeatureName — feature-detect with `adapter.features.has(...)` before use.
export const FeatureName = Object.freeze({
    CORE_FEATURES_AND_LIMITS: 'core-features-and-limits',
    DEPTH_CLIP_CONTROL: 'depth-clip-control',
    DEPTH32FLOAT_STENCIL8: 'depth32float-stencil8',
    TEXTURE_COMPRESSION_BC: 'texture-compression-bc',
    TEXTURE_COMPRESSION_BC_SLICED_3D: 'texture-compression-bc-sliced-3d',
    TEXTURE_COMPRESSION_ETC2: 'texture-compression-etc2',
    TEXTURE_COMPRESSION_ASTC: 'texture-compression-astc',
    TEXTURE_COMPRESSION_ASTC_SLICED_3D: 'texture-compression-astc-sliced-3d',
    TIMESTAMP_QUERY: 'timestamp-query',
    INDIRECT_FIRST_INSTANCE: 'indirect-first-instance',
    SHADER_F16: 'shader-f16',
    RG11B10UFLOAT_RENDERABLE: 'rg11b10ufloat-renderable',
    BGRA8UNORM_STORAGE: 'bgra8unorm-storage',
    FLOAT32_FILTERABLE: 'float32-filterable',
    FLOAT32_BLENDABLE: 'float32-blendable',
    CLIP_DISTANCES: 'clip-distances',
    DUAL_SOURCE_BLENDING: 'dual-source-blending',
    SUBGROUPS: 'subgroups',
    TEXTURE_FORMATS_TIER1: 'texture-formats-tier1',
    TEXTURE_FORMATS_TIER2: 'texture-formats-tier2',
    PRIMITIVE_INDEX: 'primitive-index',
    TEXTURE_COMPONENT_SWIZZLE: 'texture-component-swizzle',
    SUBGROUP_SIZE_CONTROL: 'subgroup-size-control',
});
