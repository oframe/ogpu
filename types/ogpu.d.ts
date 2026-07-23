/**
 * ogpu.d.ts — ambient TypeScript declarations for the OGPU WebGPU engine.
 *
 * HAND-WRITTEN, describing the public API surface of the vanilla-JS engine.
 * package.json points `types` here, so the top-level exports below ARE the
 * type surface of `import { ... } from 'ogpu'` (which resolves to
 * src/index.js). Ambient `declare module` blocks at the bottom mirror the
 * Vite path aliases for consumers importing engine files directly.
 *
 * HOW TO USE
 * ----------
 * From a TS project, `import { Renderer } from 'ogpu'` just works via the
 * package `types` field. To type-check alias imports (`@core/*`, …), mirror
 * vite.config.js in your tsconfig:
 *
 *   {
 *     "compilerOptions": {
 *       "types": ["@webgpu/types"],
 *       "baseUrl": ".",
 *       "paths": {
 *         "@core/*":    ["src/core/*"],
 *         "@math":      ["src/math"],
 *         "@modules/*": ["src/modules/*"],
 *         "@utils/*":   ["src/utils/*"],
 *         "@examples/*":["examples/*"],
 *         "@/*":        ["src/*"]
 *       }
 *     },
 *     "include": ["src", "types/ogpu.d.ts"]
 *   }
 *
 * Assumes the WebGPU lib types (`GPUDevice`, `GPUTexture`, …) are globally
 * available — install `@webgpu/types` and add it to `compilerOptions.types`,
 * or target a lib.dom that ships them.
 *
 * Types are best-effort JS typing: options objects as interfaces, `any` where
 * the real type is a webgpu-utils internal (reflection defs, buffer bundles).
 * Every declaration is derived from the actual source in `src/` and the
 * repo-root api-digest.md.
 */

// =============================================================================
// Shared / utility types
// =============================================================================

/**
 * The augmented canvas context the engine threads through nearly every
 * constructor. A `GPUCanvasContext` with `.device`, `.presentationFormat`,
 * a back-reference `.renderer`, and two shared fullscreen geometries attached.
 * Most classes take THIS object, never the raw `GPUDevice`.
 */
export interface GPU extends GPUCanvasContext {
    device: GPUDevice;
    presentationFormat: GPUTextureFormat;
    renderer: Renderer;
    /** Shared fullscreen triangle geometry for blit passes. */
    TRIANGLE: FullscreenTriangle;
    /** Shared fullscreen quad geometry (exact 4-corner interpolation). */
    QUAD: Quad;
}

/** RGBA clear color in 0..1. */
export interface ClearColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Axis-aligned bounds + bounding sphere, lazily computed by Geometry. */
export interface Bounds {
    min: Vec3;
    max: Vec3;
    center: Vec3;
    scale: Vec3;
    /** `Infinity` until computeBoundingSphere() runs. */
    radius: number;
}

/**
 * A reflected, structured uniform view (webgpu-utils makeStructuredView).
 * `views` maps each declared struct field to a typed-array view over
 * `arrayBuffer`; `set(obj)` writes by field name.
 */
export interface StructuredView {
    arrayBuffer: ArrayBuffer;
    views: Record<string, Float32Array | Uint32Array | Int32Array>;
    set(values: Record<string, unknown>): void;
}

// =============================================================================
// @math — chainable Float32Array math wrappers over wgpu-matrix
// =============================================================================
// Each subclasses Float32Array, so any instance is a drop-in arg to a
// wgpu-matrix call. Methods mutate `this` and return `this` for chaining.

export class Vec2 extends Float32Array {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number | ArrayLike<number>, y?: number): this;
    copy(v: ArrayLike<number>): this;
    clone(): Vec2;
    add(v: ArrayLike<number>): this;
    sub(v: ArrayLike<number>): this;
    multiply(v: ArrayLike<number>): this;
    scale(s: number): this;
    /** three.js-style alias for `scale`. */
    multiplyScalar(s: number): this;
    negate(): this;
    normalize(): this;
    lerp(v: ArrayLike<number>, t: number): this;
    dot(v: ArrayLike<number>): number;
    len(): number;
    lenSq(): number;
    distance(v: ArrayLike<number>): number;
    equals(v: ArrayLike<number>): boolean;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    /** OGL-name alias for `lenSq`. */
    squaredLen(): number;
}

export class Vec3 extends Float32Array {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    /** Plane constant — set externally by Camera.updateFrustum(). */
    constant?: number;
    set(x: number | ArrayLike<number>, y?: number, z?: number): this;
    copy(v: ArrayLike<number>): this;
    clone(): Vec3;
    add(v: ArrayLike<number>): this;
    sub(v: ArrayLike<number>): this;
    multiply(v: ArrayLike<number>): this;
    scale(s: number): this;
    /** three.js-style alias for `scale`. */
    multiplyScalar(s: number): this;
    addScaled(v: ArrayLike<number>, s: number): this;
    negate(): this;
    normalize(): this;
    lerp(v: ArrayLike<number>, t: number): this;
    /** Frame-rate-independent exponential smoothing toward `v` (t = 1 - exp(-decay*dt)). */
    smoothLerp(v: ArrayLike<number>, decay: number, dt: number): this;
    divide(v: ArrayLike<number>): this;
    /** Angle in radians between this vector and `v`. */
    angle(v: ArrayLike<number>): number;
    cross(v: ArrayLike<number>): this;
    min(v: ArrayLike<number>): this;
    max(v: ArrayLike<number>): this;
    applyMat4(m: ArrayLike<number>): this;
    applyMat3(m: ArrayLike<number>): this;
    applyQuat(q: ArrayLike<number>): this;
    /** Transform by the rotation/scale part of a Mat4 (keeps length scaling). */
    scaleRotateMat4(m: ArrayLike<number>): this;
    /** Transform as a direction (rotation/scale part, then normalize). */
    transformDirection(m: ArrayLike<number>): this;
    dot(v: ArrayLike<number>): number;
    len(): number;
    lenSq(): number;
    distance(v: ArrayLike<number>): number;
    distanceSq(v: ArrayLike<number>): number;
    equals(v: ArrayLike<number>): boolean;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    // --- OGL-name aliases ---
    applyMatrix4(m: ArrayLike<number>): this;
    applyMatrix3(m: ArrayLike<number>): this;
    applyQuaternion(q: ArrayLike<number>): this;
    scaleRotateMatrix4(m: ArrayLike<number>): this;
    squaredLen(): number;
    squaredDistance(v: ArrayLike<number>): number;
}

export class Vec4 extends Float32Array {
    constructor(x?: number, y?: number, z?: number, w?: number);
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number | ArrayLike<number>, y?: number, z?: number, w?: number): this;
    copy(v: ArrayLike<number>): this;
    clone(): Vec4;
    add(v: ArrayLike<number>): this;
    sub(v: ArrayLike<number>): this;
    multiply(v: ArrayLike<number>): this;
    scale(s: number): this;
    /** three.js-style alias for `scale`. */
    multiplyScalar(s: number): this;
    addScaled(v: ArrayLike<number>, s: number): this;
    negate(): this;
    normalize(): this;
    lerp(v: ArrayLike<number>, t: number): this;
    min(v: ArrayLike<number>): this;
    max(v: ArrayLike<number>): this;
    applyMat4(m: ArrayLike<number>): this;
    dot(v: ArrayLike<number>): number;
    len(): number;
    lenSq(): number;
    distance(v: ArrayLike<number>): number;
    distanceSq(v: ArrayLike<number>): number;
    equals(v: ArrayLike<number>): boolean;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    // --- OGL-name aliases ---
    applyMatrix4(m: ArrayLike<number>): this;
    squaredLen(): number;
    squaredDistance(v: ArrayLike<number>): number;
}

export class Quat extends Float32Array {
    constructor(x?: number, y?: number, z?: number, w?: number);
    x: number;
    y: number;
    z: number;
    w: number;
    /** Fired after any mutation except setFromEuler. Used by Transform's rotation proxy. */
    onChange: () => void;
    set(x: number | ArrayLike<number>, y?: number, z?: number, w?: number): this;
    copy(q: ArrayLike<number>): this;
    clone(): Quat;
    identity(): this;
    setFromEuler(x: number, y: number, z: number, order?: string): this;
    setFromAxisAngle(axis: ArrayLike<number>, angle: number): this;
    setFromRotationMatrix(m: ArrayLike<number>): this;
    multiply(q: ArrayLike<number>): this;
    premultiply(q: ArrayLike<number>): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    slerp(q: ArrayLike<number>, t: number): this;
    invert(): this;
    conjugate(): this;
    normalize(): this;
    dot(q: ArrayLike<number>): number;
    len(): number;
    equals(q: ArrayLike<number>): boolean;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    /** OGL-name alias for `setFromEuler`. */
    fromEuler(x: number, y: number, z: number, order?: string): this;
    /** OGL-name alias for `setFromAxisAngle`. */
    fromAxisAngle(axis: ArrayLike<number>, angle: number): this;
    /** OGL-name alias for `invert`. */
    inverse(): this;
}

export class Mat3 extends Float32Array {
    constructor();
    /** 9 components, or an array (native Float32Array.set fallback). */
    set(array: ArrayLike<number>, offset?: number): this;
    set(...values: number[]): this;
    copy(m: ArrayLike<number>): this;
    clone(): Mat3;
    identity(): this;
    multiply(m: ArrayLike<number>): this;
    invert(): this;
    transpose(): this;
    /** Upper 3x3 of a Mat4. */
    fromMat4(m: ArrayLike<number>): this;
    /** Build the normal matrix (adjugate) from a Mat4 world matrix. */
    fromNormalMatrix(m: ArrayLike<number>): this;
    fromQuat(q: ArrayLike<number>): this;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
}

export class Mat4 extends Float32Array {
    constructor();
    /** 16 components, or an array (native Float32Array.set fallback). */
    set(array: ArrayLike<number>, offset?: number): this;
    set(...values: number[]): this;
    copy(m: ArrayLike<number>): this;
    clone(): Mat4;
    identity(): this;
    multiply(m: ArrayLike<number>): this;
    premultiply(m: ArrayLike<number>): this;
    invert(): this;
    transpose(): this;
    fromQuat(q: ArrayLike<number>): this;
    /** Build from translation / rotation (quat) / scale. */
    compose(position: ArrayLike<number>, quaternion: ArrayLike<number>, scale: ArrayLike<number>): this;
    /** Extract translation / rotation (quat) / scale into the passed targets. */
    decompose(position: Vec3, quaternion: Quat, scale: Vec3): this;
    scale(v: ArrayLike<number>): this;
    translate(v: ArrayLike<number>): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    perspective(fovy: number, aspect: number, near: number, far: number): this;
    ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): this;
    lookAt(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>): this;
    /** Object-orientation matrix (+Z aimed eye→target); inverse-handed lookAt. */
    aim(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>): this;
    determinant(): number;
    getTranslation(out: Vec3): Vec3;
    getScale(out: Vec3): Vec3;
    getRotation(out: Quat): Quat;
    getAxis(axis: number, out: Vec3): Vec3;
    /** Largest per-axis scale factor (used to scale bounding radii to world). */
    getMaxScaleOnAxis(): number;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    /** OGL-name alias for `invert`. */
    inverse(): this;
    /** OGL-name alias for `fromQuat`. */
    fromQuaternion(q: ArrayLike<number>): this;
}

export class Euler extends Float32Array {
    constructor(x?: number, y?: number, z?: number, order?: string);
    x: number;
    y: number;
    z: number;
    order: string;
    /** Fired after any mutation except setFromQuaternion. Used by Transform's rotation proxy. */
    onChange: () => void;
    copy(e: ArrayLike<number>): this;
    clone(): Euler;
    setFromRotationMatrix(m: ArrayLike<number>, order?: string): this;
    setFromQuaternion(q: ArrayLike<number>, order?: string): this;
    /** Re-express the same orientation under a new rotation order. */
    reorder(order: string): this;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
}

/** Linear RGB color (r, g, b in 0..1). */
export class Color extends Float32Array {
    constructor(r?: number | string | ArrayLike<number>, g?: number, b?: number);
    r: number;
    g: number;
    b: number;
    /** Components, grey scalar, hex string ('#ff8800'), hex number (0xff8800), or array. */
    set(r?: number | string | ArrayLike<number>, g?: number, b?: number): this;
    setHex(hex: number | string): this;
    copy(c: ArrayLike<number>): this;
    clone(): Color;
    fromArray(a: ArrayLike<number>, offset?: number): this;
    toArray(a?: number[], offset?: number): number[];
}

// =============================================================================
// @core/Transform — scene-graph node. Everything renderable extends this.
// =============================================================================

export class Transform {
    constructor();
    parent: Transform | null;
    children: Transform[];
    visible: boolean;
    label?: string;

    matrix: Mat4;
    worldMatrix: Mat4;
    matrixAutoUpdate: boolean;
    worldMatrixNeedsUpdate: boolean;

    position: Vec3;
    quaternion: Quat;
    /** OGL-style two-way Euler proxy synced with `quaternion` via onChange hooks. */
    rotation: Euler;
    scale: Vec3;
    up: Vec3;

    setParent(parent: Transform | null, notifyParent?: boolean): void;
    addChild(child: Transform, notifyChild?: boolean): void;
    removeChild(child: Transform, notifyChild?: boolean): void;
    updateMatrixWorld(force?: boolean): void;
    updateMatrix(): void;
    /** Depth-first walk; return `true` from the callback to skip children. */
    traverse(callback: (node: Transform) => boolean | void): void;
    lookAt(target: ArrayLike<number>, invert?: boolean): void;

    /** Decompose local `matrix` back into position / quaternion / scale. */
    decompose(): this;
    setRotation(quaternion: Quat): void;
    rotateX(angle: number): void;
    rotateY(angle: number): void;
    rotateZ(angle: number): void;
    getEuler(out?: Euler): Euler;
}

// =============================================================================
// @core/Camera — perspective by default, orthographic if left/right set.
// =============================================================================

export interface CameraOptions {
    near?: number;
    far?: number;
    fov?: number;
    aspect?: number;
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
    zoom?: number;
}

export class Camera extends Transform {
    constructor(options?: CameraOptions);
    near: number;
    far: number;
    fov: number;
    aspect: number;
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
    zoom: number;
    type: 'perspective' | 'orthographic';

    projectionMatrix: Mat4;
    viewMatrix: Mat4;
    projectionViewMatrix: Mat4;
    worldPosition: Vec3;
    /** 6 frustum planes (Vec3 normal + `.constant`); built by updateFrustum(). */
    frustum?: Vec3[];

    perspective(opts?: Pick<CameraOptions, 'near' | 'far' | 'fov' | 'aspect'>): this;
    orthographic(opts?: CameraOptions): this;
    updateMatrixWorld(): this;
    updateProjectionMatrix(): this;
    lookAt(target: ArrayLike<number>): this;
    /** Project a 3D point to clip space (mutates `v`). */
    project(v: Vec3): this;
    /** Unproject a clip-space point to world space (mutates `v`). */
    unproject(v: Vec3): this;
    updateFrustum(): void;
    frustumIntersectsMesh(node: Mesh | Transform, worldMatrix?: Mat4): boolean;
    frustumIntersectsSphere(center: Vec3, radius: number): boolean;
    /** Visible frustum extents at distance `z` (defaults to `far`). */
    getFrustumSize(z?: number): { width: number; height: number };
}

// =============================================================================
// @core/Geometry — wraps webgpu-utils buffer/attribute creation.
// =============================================================================

/**
 * webgpu-utils attribute arrays. Each entry is a typed array or a descriptor
 * `{ data, numComponents }`.
 */
export type GeometryData = Record<string, ArrayLike<number> | { data: ArrayLike<number>; numComponents?: number }>;

export interface GeometryOptions {
    /** Required — non-instanced attribute arrays. */
    data: GeometryData;
    instancedData?: GeometryData;
    interleave?: boolean;
    /** GPUBuffer for drawIndirect / drawIndexedIndirect (indirect instance count). */
    drawBuffer?: GPUBuffer | null;
    /**
     * Extra GPUBufferUsage flags OR'd into every vertex/instance buffer.
     * webgpu-utils creates them VERTEX-only — pass GPUBufferUsage.COPY_DST
     * if you plan to queue.writeBuffer them at runtime.
     */
    usage?: GPUBufferUsageFlags;
}

export class Geometry {
    constructor(gpu: GPU, options: GeometryOptions);
    attributes: GeometryData;
    drawBuffer: GPUBuffer | null;
    /** webgpu-utils BuffersAndAttributes (buffers, bufferLayouts, indexBuffer, numElements…). */
    nonInstancedVerts: any;
    /** webgpu-utils BuffersAndAttributes, `{}` when not instanced. */
    instancedVerts: any;
    hasInstancedAttributes: boolean;
    /** True when the geometry has per-instance attributes or a drawBuffer. */
    readonly instanced: boolean;
    bufferLayouts: GPUVertexBufferLayout[];
    numBuffers: number;
    bounds?: Bounds;
    /** Set to 'sphere' to prefer sphere over AABB in Raycast. */
    raycast?: 'sphere';
    /** Set by GLTFLoader.getGeometry: whether the tangent attribute is real. */
    hasTangents?: boolean;

    computeBoundingBox(attr?: { data: ArrayLike<number>; stride: number } | null): Bounds | null;
    computeBoundingSphere(attr?: { data: ArrayLike<number>; stride: number } | null): Bounds | null;
    destroy(): void;
}

// =============================================================================
// @core/primitives — Geometry subclasses wrapping webgpu-utils shape generators.
// =============================================================================

/**
 * Shape options are forwarded to the matching webgpu-utils
 * `primitives.create*Vertices` call (size, radius, subdivisions, …);
 * `instancedData`/`interleave` pass through to Geometry. Note: `usage` is NOT
 * forwarded — use a plain Geometry when buffers need runtime updates.
 */
export interface PrimitiveOptions {
    instancedData?: GeometryData;
    interleave?: boolean;
    [shapeOption: string]: unknown;
}

export class Box extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    /** Resolved shape options, for introspection. */
    parameters: Record<string, unknown>;
}
export class Sphere extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Plane extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Torus extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Cylinder extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Disc extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Cone extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
export class Quad extends Geometry {
    constructor(gpu: GPU, options?: PrimitiveOptions);
    parameters: Record<string, unknown>;
}
/** Single oversized fullscreen triangle (cheapest blit geometry). */
export class FullscreenTriangle extends Geometry {
    constructor(gpu: GPU, options?: { instancedData?: GeometryData; interleave?: boolean });
}

// =============================================================================
// @core/RenderPipeline — pure compiled state (module + defs + GPURenderPipeline).
// Owns NO uniform buffer and NO bind groups — those are per-Mesh concerns.
// =============================================================================

/** Blend descriptors per GPUBlendState. */
export interface BlendingOptions {
    color?: GPUBlendComponent;
    alpha?: GPUBlendComponent;
}

export interface RenderPipelineOptions {
    label?: string;
    /** Raw WGSL source. Must declare a `vs` entry point (`fs` optional for depth-only passes). */
    code: string;
    /** Vertex buffer layout(s) — typically `geometry.bufferLayouts`. Never the geometry instance. */
    vertexBuffers?: GPUVertexBufferLayout[];
    targets?: GPUColorTargetState[];
    depthTest?: boolean;
    depthWrite?: boolean;
    /**
     * Three-way:
     *   `false`          → omit depth state entirely (fullscreen/blit/VFX passes);
     *   `{}` (default)   → engine default depth24plus state derived from depthTest/depthWrite;
     *   populated object → used verbatim (e.g. depthBias / depth32float shadow passes).
     */
    depthStencil?: false | GPUDepthStencilState | Record<string, never>;
    transparent?: boolean;
    cullMode?: GPUCullMode;
    topology?: GPUPrimitiveTopology;
    blending?: BlendingOptions;
    sampleCount?: number;
    /** Override constants, baked into the WGSL source (Safari-safe). */
    constants?: Record<string, number>;
}

export class RenderPipeline {
    constructor(gpu: GPU, options: RenderPipelineOptions);
    label: string;
    gpu: GPU;
    id: number;
    code: string;
    vertexBuffers: GPUVertexBufferLayout[];
    module: GPUShaderModule;
    /** makeShaderDataDefinitions result (webgpu-utils reflection). */
    defs: any;
    pipeline: GPURenderPipeline;
    depthTest: boolean;
    depthWrite: boolean;
    depthStencil: false | GPUDepthStencilState | Record<string, never>;
    transparent: boolean;
    cullMode: GPUCullMode;
    /**
     * True when the shader has a used uniform at group(0)/binding(0) — the
     * entry is marked hasDynamicOffset and Mesh.draw/blit bind it with a
     * dynamic offset into the shared PerDrawBuffer.
     */
    hasDynamicUniform: boolean;

    /** Recompile + recreate the GPURenderPipeline from `code`. */
    build(code: string): void;
    /**
     * Explicit, hot-reload-stable bind group layout for `groupIndex` — build
     * your bind groups against this, not pipeline.getBindGroupLayout.
     */
    bindGroupLayout(groupIndex?: number): GPUBindGroupLayout;
    /** Hot-reload entry point (Meshes detect the reload via `defs` identity). */
    reload(code: string): void;
    /** Unregisters from the hot-reload registry. */
    destroy(): void;
}

// =============================================================================
// @core/PerDrawBuffer — renderer-owned shared per-draw uniform buffer.
// =============================================================================

export class PerDrawBuffer {
    constructor(gpu: GPU, options?: { label?: string; size?: number });
    gpu: GPU;
    size: number;
    /** minUniformBufferOffsetAlignment of the device. */
    align: number;
    buffer: GPUBuffer;
    pointer: number;

    /** Next aligned slice; caller writes its uniforms at the returned offset. */
    alloc(byteLength: number): number;
    /** Rewind the pointer — Renderer calls this once per rendered frame. */
    reset(): void;
}

// =============================================================================
// @core/Mesh — owns its uniform view + bind groups; draws via a shared pipeline.
// =============================================================================

/** Slice descriptor into the shared PerDrawBuffer for group(0) binding(0). */
export interface UniformResource {
    buffer: GPUBuffer;
    offset: number;
    size: number;
}

export interface MeshOptions {
    label?: string;
    pipeline: RenderPipeline;
    geometry: Geometry;
    /**
     * REQUIRED. Either the bind groups themselves, or a factory receiving the
     * mesh's `uniformResource` (slice descriptor into the shared per-draw
     * buffer) so group(0) can bind it at binding 0.
     */
    bindGroups: GPUBindGroup[] | ((uniformResource: UniformResource) => GPUBindGroup[]);
    manualRender?: boolean;
    renderOrder?: number;
    frustumCulled?: boolean;
}

export interface DrawArgs {
    camera?: Camera | null;
    pass: GPURenderPassEncoder;
    time?: number;
    /** [width, height] of the pass target; defaults to the canvas size. */
    resolution?: [number, number] | number[] | null;
}

export class Mesh extends Transform {
    constructor(gpu: GPU, options: MeshOptions);
    label: string;
    gpu: GPU;
    manualRender: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    pipeline: RenderPipeline;
    geometry: Geometry;
    /** Structured uniform view built from the pipeline's reflected `uniforms` struct. */
    uniforms: StructuredView;
    /** Byte length of the reflected uniform struct. */
    structSize: number;
    /** Slice descriptor into the shared PerDrawBuffer (bind at group(0) binding(0)). */
    uniformResource: UniformResource;
    bindGroups: GPUBindGroup[];
    modelViewMatrix: Mat4;
    normalMatrix: Mat3;
    objectMatrix: Mat4;
    /** Set by Renderer.getRenderQueue for sorting. */
    zDepth?: number;
    /** Reused result object populated by Raycast — copy what you need. */
    hit?: any;

    onBeforeRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    onAfterRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    draw(args: DrawArgs): void;
}

// =============================================================================
// @core/ComputeShader — pure compiled state; one pipeline per entry point.
// Owns kernels + layouts, never bind groups (callers build their own).
// =============================================================================

export interface ComputeShaderOptions {
    label?: string;
    /** Raw WGSL. Every entry point becomes a kernel keyed by its name. */
    code: string;
    layout?: GPUPipelineLayout | 'auto';
    /** Override constants, baked into the WGSL source (Safari-safe). */
    constants?: Record<string, number>;
    size?: number;
}

export interface DispatchOptions {
    /** External compute pass to record into (dispatch won't begin/end its own). */
    pass?: GPUComputePassEncoder | null;
    kernel: GPUComputePipeline;
    bindGroup: GPUBindGroup;
    bindGroupIndex?: number;
    /** [x, y?, z?] workgroup counts. */
    dispatchCount: number[];
    /** Pass a buffer to use dispatchWorkgroupsIndirect instead. */
    workgroupBuffer?: GPUBuffer | null;
    /** Timestamp the pass (only when 'timestamp-query' is available and no external pass). */
    timing?: boolean;
}

export class ComputeShader {
    constructor(gpu: GPU, options: ComputeShaderOptions);
    label: string;
    gpu: GPU;
    code: string;
    module: GPUShaderModule;
    /** makeShaderDataDefinitions result (webgpu-utils reflection). */
    defs: any;
    /** Entry-point name → compute pipeline. Object reference stays stable across reloads. */
    kernels: Record<string, GPUComputePipeline>;
    /** Present only when the device has 'timestamp-query'. */
    querySet?: GPUQuerySet | null;
    queryBuffer?: GPUBuffer | null;
    queryBufferResult?: GPUBuffer | null;

    /** Recompile the module and rebuild one pipeline per entry point. */
    build(code: string): void;
    /** Hot-reload entry point. */
    reload(code: string): void;
    isValidKernel(key: string): boolean;
    findKernel(key: string): GPUComputePipeline | undefined;
    /**
     * Persistent, hot-reload-stable bind group layout for a kernel's group
     * index. Accepts the kernel object (uses its label) or the entry-point name.
     */
    bindGroupLayout(kernelOrKey: GPUComputePipeline | string, groupIndex?: number): GPUBindGroupLayout;
    dispatch(encoder: GPUCommandEncoder, options: DispatchOptions): Promise<void>;
    /** Releases timestamp-query resources and drops out of the hot-reload registry. */
    destroy(): void;
    getTiming(): Promise<void>;
}

// =============================================================================
// @core/Texture — destroy/recreate wrapper with mip upload support.
// =============================================================================

export interface TextureOptions {
    width?: number;
    height?: number;
    depth?: number;
    data?: ArrayBufferView | ArrayBufferView[] | null;
    format?: GPUTextureFormat;
    dimension?: GPUTextureDimension;
    sampleCount?: number;
    generateMipmaps?: boolean;
    mips?: boolean;
    mipLevelCount?: number;
    usage?: GPUTextureUsageFlags;
    label?: string;
    isCubeMap?: boolean;
    /** URL string(s) or decoded source(s) — triggers the async load path. */
    src?: string | string[] | ImageBitmap | ImageBitmap[] | HTMLCanvasElement | OffscreenCanvas | null;
    flipY?: boolean;
}

export class Texture {
    constructor(gpu: GPU, options?: TextureOptions);
    gpu: GPU;
    id: number;
    label: string;
    /** `null` until `ready` resolves when constructed with `src`. */
    texture: GPUTexture | null;
    width: number;
    height: number;
    depth: number;
    format: GPUTextureFormat;
    dimension: GPUTextureDimension;
    usage: GPUTextureUsageFlags;
    sampleCount: number;
    mipLevelCount: number;
    generateMipmaps: boolean;
    isCubeMap: boolean;
    isDestroyed: boolean;
    /** Resolves to `this` once the (possibly async) texture is created. */
    ready: Promise<this>;

    update(options?: {
        width?: number;
        height?: number;
        depth?: number;
        data?: ArrayBufferView | ArrayBufferView[] | null;
        format?: GPUTextureFormat;
        dimension?: GPUTextureDimension;
        usage?: GPUTextureUsageFlags;
        sampleCount?: number;
        mipLevelCount?: number;
    }): void;
    createView(): GPUTextureView;
    destroy(): void;
}

// =============================================================================
// @core/RenderTarget — owns one or more Textures (MRT), optional MSAA + depth.
// =============================================================================

export interface RenderTargetTextureSpec {
    format: GPUTextureFormat;
    usage?: GPUTextureUsageFlags;
    label?: string;
}

export interface RenderTargetOptions {
    width?: number;
    height?: number;
    depth?: number;
    format?: GPUTextureFormat;
    dimension?: GPUTextureDimension;
    /** false → depth-only target (shadow maps): no color attachments. */
    color?: boolean;
    /** Create an owned depth texture. */
    depthTexture?: boolean;
    depthFormat?: GPUTextureFormat;
    sampleCount?: number;
    generateMipmaps?: boolean;
    mipLevelCount?: number;
    usage?: GPUTextureUsageFlags;
    label?: string;
}

export class RenderTarget {
    constructor(gpu: GPU, options?: RenderTargetOptions, textures?: RenderTargetTextureSpec[]);
    gpu: GPU;
    label: string;
    width: number;
    height: number;
    depth: number;
    sampleCount: number;
    color: boolean;
    depthFormat: GPUTextureFormat;
    /** Color attachments (textures[0] is the primary); empty when color: false. */
    textures: Texture[];
    /** Primary color texture (alias of textures[0]); undefined when color: false. */
    texture?: Texture;
    msaaTextures: Texture[];
    /** Present only when constructed with depthTexture: true (a raw GPUTexture). */
    depthTexture?: GPUTexture;

    createTextures(): void;
    createDepthTexture(): void;
    /** View of color attachment `i` (defaults to primary). */
    createView(i?: number): GPUTextureView;
    /** Cached view of depthTexture; invalidated by createDepthTexture(). */
    depthView(): GPUTextureView;
    /** `{ format, usage }` per attachment, for RenderPipeline's `targets`. */
    getTargets(): GPUColorTargetState[];
    destroy(): void;
    onResize(size?: { width?: number; height?: number; depth?: number }): void;
}

// =============================================================================
// @core/skin/Skin — GPU skinning compute pass.
// =============================================================================

/**
 * Rig + geometry data shape Skin consumes — the raw attribute/rig data
 * returned by GLTFLoader.getSkinData (NOT a Skin instance).
 */
export interface SkinData {
    position: ArrayLike<number>;
    normal: ArrayLike<number>;
    uv?: ArrayLike<number>;
    indices?: ArrayLike<number>;
    skinIndex: ArrayLike<number>;
    skinWeight: ArrayLike<number>;
    /** Parsed rig: bones, bindPose, inverseBindMatrices?, skeletonAncestors?. */
    rig: any;
}

export class Skin {
    constructor(gpu: GPU, options: { label?: string; data: SkinData });
    gpu: GPU;
    label: string;
    rig: any;
    root: Transform;
    bones: Transform[];
    /** Live transforms for non-joint rig ancestors (armature/root-motion nodes). */
    skeletonBones: Transform[];
    /** Transforms an Animation drives: skeleton ancestors first, then joints. */
    poseTransforms: Transform[];
    animations: Map<string, Animation>;
    threadCount: number;
    /** Skinned output storage buffers consumed by the render pipeline. */
    skinnedPositionBuffer: GPUBuffer;
    skinnedNormalBuffer: GPUBuffer;
    boneMatrixBuffer: GPUBuffer;
    invBoneMatrixBuffer: GPUBuffer;
    skinner: ComputeShader;
    skinningBindGroup: GPUBindGroup;

    initBones(): void;
    createGeometryBuffer(name: string, size: number, data: ArrayBufferView): GPUBuffer;
    initSkinning(): void;
    addAnimation(animation: Animation): void;
    getAnimation(label: string): Animation | undefined;
    /** Blend all registered animations into the bone pose. */
    applyAnimations(): void;
    /** Push current bone world matrices to the bone matrix buffer. */
    updateBones(): void;
    /** applyAnimations() + updateBones() + skinning dispatch (own submit). */
    update(dt?: number): void;
}

// =============================================================================
// @core/Renderer — owns device, context, depth texture, RAF loop, render queue.
// =============================================================================

export interface RendererOptions {
    canvas?: HTMLCanvasElement | null;
    dpr?: number | null;
    transparent?: boolean;
    depth?: boolean;
    /** Byte size of the shared per-draw uniform buffer (default 1 MiB). */
    perDrawSize?: number;
}

export interface RenderOptions {
    scene: Transform;
    camera?: Camera;
    /** null → draw to the canvas bound by setContext (default canvas otherwise). */
    target?: RenderTarget | null;
    loadOp?: GPULoadOp;
    storeOp?: GPUStoreOp;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
    timing?: boolean;
    /** Chain multiple passes into one submit; the caller owns finish/submit. */
    encoder?: GPUCommandEncoder | null;
    frustumCull?: boolean;
    /** Refresh camera/scene world matrices this frame (default true). */
    updateMatrices?: boolean;
}

export interface UpdateArgs {
    time: number;
    deltaTime: number;
}

export class Renderer {
    constructor(options?: RendererOptions);
    canvas: HTMLCanvasElement;
    dpr: number;
    width: number;
    height: number;
    perDrawSize: number;
    depth: boolean;
    transparent: boolean;
    clearColor: ClearColor;
    time: number;
    deltaTime: number;
    prevTime: number;
    paused: boolean;
    isReady: boolean;
    /** `await renderer.ready` before touching the device/context. */
    ready: Promise<void>;
    /** The augmented canvas context (`.device`, `.presentationFormat`, `.renderer`, …). */
    gpu: GPU;
    presentationFormat: GPUTextureFormat;
    /** Shared per-draw uniform buffer (null after destroy()). */
    perDraw: PerDrawBuffer | null;
    depthTexture?: GPUTexture | null;
    renderQueue?: Mesh[];
    timingHelper?: TimingHelper;

    /** Acquire (or re-acquire, on device loss) the adapter/device. Runs from the constructor. */
    initDevice(): Promise<void>;
    /** One-time setup once the first device arrives (canvas, handlers, loop). */
    init(device: GPUDevice): void;
    createDepthTexture(): void;
    addHandlers(): void;

    /** Register a per-frame callback. */
    add(cb: (args: UpdateArgs) => void): void;
    remove(cb: (args: UpdateArgs) => void): void;
    /** Fired whenever the canvas backing store resizes; receives (width, height). Returns an unsubscribe fn. */
    addResizeHandler(cb: (width: number, height: number) => void): () => void;
    /** Fired when the device is lost, before recovery starts. Returns an unsubscribe fn. */
    addDeviceLostHandler(cb: (info: GPUDeviceLostInfo) => void): () => void;
    /** Fired after recovery with the fresh `gpu` — rebuild your GPU resources here. Returns an unsubscribe fn. */
    addDeviceRestoredHandler(cb: (gpu: GPU) => void): () => void;
    /** Fired for every uncaptured GPU error; event.preventDefault() silences the browser report. Returns an unsubscribe fn. */
    addErrorHandler(cb: (error: GPUError, event: GPUUncapturedErrorEvent) => void): () => void;
    /** Boot progress, 0–100 (monotonic). Returns an unsubscribe fn. */
    addBootProgressHandler(cb: (pct: number) => void): () => void;
    /** Fired once when boot finishes and the scene is ready to show. Returns an unsubscribe fn. */
    addBootCompleteHandler(cb: () => void): () => void;
    /** Test hook: exercise the device-loss recovery path without a real loss. */
    forceDeviceLoss(): void;
    /** Full teardown (SPA route change) — the renderer is dead afterwards. */
    destroy(): void;

    pause(): void;
    resume(): void;
    setClearColor(color?: Partial<ClearColor>): void;
    /** Register an async setup promise for the boot lifecycle to wait on. */
    trackCompile(promise: Promise<unknown>): void;
    updateClock(time?: number): void;
    sortOpaque(a: Mesh, b: Mesh): number;
    sortTransparent(a: Mesh, b: Mesh): number;
    sortUI(a: Mesh, b: Mesh): number;
    getRenderQueue(options: { scene: Transform; camera?: Camera; sort?: boolean; frustumCull?: boolean }): Mesh[];
    render(options: RenderOptions): void;
    /** Bind another canvas for exactly the next render(); null restores now. */
    setContext(canvas?: HTMLCanvasElement | null): void;
    /** Configured, augmented context for any canvas — its view is a pass `target`. */
    contextFor(canvas: HTMLCanvasElement): GPU;
}

// =============================================================================
// @core/ShaderReload — hot-reload registry (dev only; not in the barrel).
// =============================================================================

/** Register a RenderPipeline/ComputeShader for WGSL hot-reload. Returns an unregister fn. */
export function registerShader(instance: RenderPipeline | ComputeShader): () => void;

// =============================================================================
// @core/GPUEnums — named constants for the WebGPU string enums.
// Keys are the spec string uppercased with '-' → '_' ('2d-array' → D2_ARRAY).
// =============================================================================

export const TextureFormat: Readonly<Record<string, GPUTextureFormat>>;
export const VertexFormat: Readonly<Record<string, GPUVertexFormat>>;
export const AlphaMode: Readonly<Record<string, GPUCanvasAlphaMode>>;
export const BlendFactor: Readonly<Record<string, GPUBlendFactor>>;
export const BlendOperation: Readonly<Record<string, GPUBlendOperation>>;
export const CompareFunction: Readonly<Record<string, GPUCompareFunction>>;
export const StencilOperation: Readonly<Record<string, GPUStencilOperation>>;
export const PrimitiveTopology: Readonly<Record<string, GPUPrimitiveTopology>>;
export const FrontFace: Readonly<Record<string, GPUFrontFace>>;
export const CullMode: Readonly<Record<string, GPUCullMode>>;
export const IndexFormat: Readonly<Record<string, GPUIndexFormat>>;
export const VertexStepMode: Readonly<Record<string, GPUVertexStepMode>>;
export const LoadOp: Readonly<Record<string, GPULoadOp>>;
export const StoreOp: Readonly<Record<string, GPUStoreOp>>;
export const AddressMode: Readonly<Record<string, GPUAddressMode>>;
export const FilterMode: Readonly<Record<string, GPUFilterMode>>;
export const MipmapFilterMode: Readonly<Record<string, GPUMipmapFilterMode>>;
export const TextureDimension: Readonly<Record<string, GPUTextureDimension>>;
export const TextureViewDimension: Readonly<Record<string, GPUTextureViewDimension>>;
export const TextureAspect: Readonly<Record<string, GPUTextureAspect>>;
export const BufferBindingType: Readonly<Record<string, GPUBufferBindingType>>;
export const SamplerBindingType: Readonly<Record<string, GPUSamplerBindingType>>;
export const TextureSampleType: Readonly<Record<string, GPUTextureSampleType>>;
export const StorageTextureAccess: Readonly<Record<string, GPUStorageTextureAccess>>;
export const AutoLayoutMode: Readonly<Record<string, GPUAutoLayoutMode>>;
export const CanvasToneMappingMode: Readonly<Record<string, string>>;
export const QueryType: Readonly<Record<string, GPUQueryType>>;
export const PowerPreference: Readonly<Record<string, GPUPowerPreference>>;
export const BufferMapState: Readonly<Record<string, GPUBufferMapState>>;
export const DeviceLostReason: Readonly<Record<string, GPUDeviceLostReason>>;
export const ErrorFilter: Readonly<Record<string, GPUErrorFilter>>;
export const CompilationMessageType: Readonly<Record<string, GPUCompilationMessageType>>;
export const PipelineErrorReason: Readonly<Record<string, GPUPipelineErrorReason>>;
export const FeatureName: Readonly<Record<string, GPUFeatureName>>;

// =============================================================================
// Modules (@modules/*)
// =============================================================================

// --- @modules/Orbit (constructor function, port of three OrbitControls) ------
export interface OrbitOptions {
    element?: HTMLElement | Document;
    enabled?: boolean;
    target?: Vec3 | ArrayLike<number>;
    ease?: number;
    inertia?: number;
    enableRotate?: boolean;
    rotateSpeed?: number;
    autoRotate?: boolean;
    autoRotateSpeed?: number;
    enableZoom?: boolean;
    zoomSpeed?: number;
    zoomStyle?: 'dolly' | string;
    enablePan?: boolean;
    panSpeed?: number;
    minPolarAngle?: number;
    maxPolarAngle?: number;
    minAzimuthAngle?: number;
    maxAzimuthAngle?: number;
    minDistance?: number;
    maxDistance?: number;
}

export interface OrbitControls {
    enabled: boolean;
    target: Vec3;
    zoomStyle: string;
    minDistance: number;
    maxDistance: number;
    /** Call each frame to apply inertia/easing to the controlled object. */
    update(): void;
    /** Snap the internal spherical state to the object's current position. */
    forcePosition(): void;
    /** Remove all event listeners. */
    remove(): void;
}

/** `new Orbit(object, opts)` — attaches orbit controls to a Transform/Camera. */
export interface OrbitConstructor {
    new (object: Transform, options?: OrbitOptions): OrbitControls;
}
export const Orbit: OrbitConstructor;

// --- @modules/Raycast (port of OGL Raycast) ----------------------------------
export interface RaycastIntersectOptions {
    cullFace?: boolean;
    maxDistance?: number;
    includeUV?: boolean;
    includeNormal?: boolean;
    output?: Mesh[];
}

export class Raycast {
    constructor();
    origin: Vec3;
    direction: Vec3;
    /** Build the ray from NDC mouse coords ([-1,1], y up). */
    castMouse(camera: Camera, mouse?: [number, number] | number[]): this;
    /** Fast sphere/AABB test; returns hit meshes sorted near→far. */
    intersectBounds(meshes: Mesh[], options?: { maxDistance?: number; output?: Mesh[] }): Mesh[];
    /** Exact CPU triangle test; populates each mesh's `.hit`. */
    intersectMeshes(meshes: Mesh[], options?: RaycastIntersectOptions): Mesh[];
    intersectPlane(plane: any, origin?: Vec3, direction?: Vec3, out?: Vec3 | null): Vec3 | null;
    intersectSphere(sphere: any, origin?: Vec3, direction?: Vec3): number;
    intersectBox(box: any, origin?: Vec3, direction?: Vec3): number;
    intersectTriangle(a: Vec3, b: Vec3, c: Vec3, backfaceCulling?: boolean, origin?: Vec3, direction?: Vec3, normal?: Vec3): number;
    getBarycoord(point: Vec3, a: Vec3, b: Vec3, c: Vec3, target?: Vec3): Vec3;
}

// --- @modules/GUI (thin Tweakpane wrapper) -----------------------------------
export interface GUIOptions {
    title?: string;
    expanded?: boolean;
    container?: HTMLElement;
    /** A Tweakpane FolderApi when nesting (used internally by folder()). */
    pane?: unknown;
}

/**
 * Target shape for gui.uniform(): any object owning `.uniforms` + `.gpu` — a
 * Mesh, or a pass that owns its own uniform buffer. NOT a RenderPipeline
 * (pipelines no longer own uniforms). `.uniformBuffer` is optional: present on
 * passes with a private buffer (written immediately), absent on Meshes (value
 * lands in `.uniforms` and uploads at the next draw).
 */
export interface UniformTarget {
    uniforms: StructuredView;
    gpu: GPU;
    uniformBuffer?: GPUBuffer;
}

export class GUI {
    constructor(options?: GUIOptions);
    /** The raw Tweakpane Pane/FolderApi for anything not wrapped here. */
    pane: any;
    /** Bind a property; returns the Tweakpane binding. */
    add(obj: object, key: string, opts?: Record<string, unknown>): any;
    /** Read-only readout (e.g. fps). */
    monitor(obj: object, key: string, opts?: Record<string, unknown>): any;
    button(title: string, onClick: () => void): any;
    /** Returns a GUI scoped to a sub-folder. */
    folder(title: string, opts?: { expanded?: boolean }): GUI;
    /** Bind a uniform on a Mesh/pass; writes through target.uniforms.set on change. */
    uniform(target: UniformTarget, key: string, opts?: Record<string, unknown>): any;
    dispose(): void;
}

// --- @modules/Animation (keyframe playback over a list of Transforms) --------
export interface AnimationFrame {
    position: Float32Array;
    quaternion: Float32Array;
    scale: Float32Array;
}

/** Baked keyframe data, e.g. the return of GLTFLoader.getAnimation. */
export interface AnimationData {
    label?: string;
    frames: AnimationFrame[];
}

export interface AnimationOptions {
    transforms?: Transform[];
    label?: string;
    data?: AnimationData;
    loop?: boolean;
}

export class Animation {
    constructor(options?: AnimationOptions);
    label: string;
    transforms: Transform[];
    loop: boolean;
    /** In FRAMES, not seconds — advance with `elapsed += dt * fps()`. */
    elapsed: number;
    /** Total frame count. */
    duration: number;
    weight: number;
    data: AnimationData;
    /** Set fps (chainable) or get it (throws if never set). Required before update(). */
    fps(): number;
    fps(value: number): this;
    /** Advance + write to the driven transforms. `isSet` resets the accumulated pose. */
    update(totalWeight?: number, isSet?: boolean): void;
}

// --- @modules/GLTFLoader -----------------------------------------------------
export interface GLTFLoaderOptions {
    /** PBR shader WGSL. Required unless dataOnly. */
    code?: string;
    iblEntries?: GPUBindGroupEntry[];
    /** Override constants forwarded to every primitive pipeline (e.g. roughnessLevels). */
    constants?: Record<string, number>;
    targets?: GPUColorTargetState[] | null;
    sampleCount?: number;
    /** Parse geometry/skin/animation only — no pipelines/materials/textures. */
    dataOnly?: boolean;
}

/** Raw attribute arrays for a decoded static primitive (dataOnly path). */
export interface GLTFGeometryData {
    name: string;
    node: number;
    material: number;
    /** True only when the glTF carried real tangents. */
    hasTangents: boolean;
    position: Float32Array;
    normal: Float32Array;
    uv: Float32Array;
    /** vec4 (xyz + sign) or null when the file had none. */
    tangent: Float32Array | null;
    indices: Uint16Array | Uint32Array | null;
}

/** IBL resource bundle getSkinnedMesh expects (shape returned by an initIBL helper). */
export interface IBLResources {
    specView: GPUTextureView;
    mipLevels: number;
    shBuffer: GPUBuffer;
    lutTexture: GPUTexture;
}

export class GLTFLoader {
    constructor(gpu: GPU, options?: GLTFLoaderOptions);
    gpu: GPU;
    dataOnly: boolean;
    meshes: Mesh[];
    pipelines: RenderPipeline[];
    /** Parsed rigs (one per glTF skin). */
    skins: Array<{ rig: any }>;
    /** Parsed animation channels (raw; resampled on demand by getAnimation). */
    animations: any[];
    /** Parsed skinned-mesh records (skin attributes + indices), NOT engine Meshes. */
    skinnedMeshes: any[];
    /** dataOnly: decoded non-skinned primitives (raw attribute arrays). */
    staticMeshes: any[];
    /** The built scene graph (also returned by load()). */
    scene?: Transform;
    json?: any;

    /** Fetch + parse a .gltf/.glb, returning the scene graph. */
    load(url: string): Promise<Transform>;
    /** Raw rig/attribute data for `new Skin(gpu, { data })` — NOT a Skin instance. */
    getSkinData(meshOrIndex?: number | object): SkinData | null;
    /** dataOnly: turnkey skinned PBR mesh — builds Skin + Animation + Mesh. */
    getSkinnedMesh(options: {
        code: string;
        ibl: IBLResources;
        mesh?: number;
        animation?: number;
        fps?: number;
        label?: string;
        material?: Record<string, unknown>;
    }): Promise<{ mesh: Mesh; skin: Skin; animation: Animation } | null>;
    /** dataOnly: raw attribute arrays for a decoded static primitive. */
    getGeometryData(meshOrIndex?: number | object): GLTFGeometryData | null;
    /** dataOnly: build an engine Geometry from a decoded static primitive. */
    getGeometry(meshOrIndex?: number | object): Geometry | null;
    /** Resample an animation to uniform frames, for `new Animation({ data })`. */
    getAnimation(options?: { animation?: number; skin?: number; fps?: number }): AnimationData | null;
    /** Decode one material map to an engine Texture (null when the material lacks it). */
    getMaterialTexture(materialIndex?: number, map?: 'baseColor' | 'metallicRoughness' | 'normal' | 'occlusion' | 'emissive'): Promise<Texture | null>;
}

// --- @modules/CubeMap ---------------------------------------------------------
export interface CubeMapOptions {
    /** 6 face sources in WebGPU/D3D cube order: +X, -X, +Y, -Y, +Z, -Z. */
    src: Array<string | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas>;
    mips?: boolean;
    flipY?: boolean;
    usage?: GPUTextureUsageFlags;
    label?: string;
}

export class CubeMap {
    constructor(gpu: GPU, options: CubeMapOptions);
    /** Resolves to `this` once all faces are uploaded. */
    ready: Promise<this>;
    readonly texture: GPUTexture | null;
    /** `dimension: 'cube'` view — bind as `texture_cube<f32>`. */
    readonly view: GPUTextureView | undefined;
    destroy(): void;
}

// --- @modules/VideoTexture ----------------------------------------------------
export interface VideoTextureOptions {
    /** URL string (element is created and owned) or an existing video element. */
    video: string | HTMLVideoElement;
    format?: GPUTextureFormat;
    label?: string;
    autoStart?: boolean;
    flipY?: boolean;
}

export class VideoTexture {
    constructor(gpu: GPU, options: VideoTextureOptions);
    gpu: GPU;
    id: number;
    label: string;
    format: GPUTextureFormat;
    flipY: boolean;
    autoStart: boolean;
    /** `null` until video metadata loads (await `ready`). */
    texture: GPUTexture | null;
    video: HTMLVideoElement | null;
    isDestroyed: boolean;
    /** Resolves once the texture exists (metadata loaded and sized). */
    ready: Promise<this>;
    readonly width: number;
    readonly height: number;

    start(): void;
    stop(): void;
    createView(): GPUTextureView | null;
    destroy(): void;
}

// --- @modules/KTXTexture ------------------------------------------------------
export interface KTXTextureOptions {
    /** URL of a .ktx / .ktx2 file (Basis supercompression transcoded automatically). */
    src: string;
    usage?: GPUTextureUsageFlags;
    label?: string;
}

/** Requires `window.ktx` (the Khronos KTX reader), ready after `renderer.ready`. */
export class KTXTexture extends Texture {
    constructor(gpu: GPU, options: KTXTextureOptions);
    src: string;
}

// =============================================================================
// Utils (@utils/*)
// =============================================================================

// --- @utils/BufferUtils --------------------------------------------------------
export interface CreateBufferOptions {
    label?: string;
    size: number;
    usage?: GPUBufferUsageFlags;
}
/** createBuffer with GPUBufferUsage.STORAGE OR'd in. */
export function createStorageBuffer(gpu: GPU, options: CreateBufferOptions): GPUBuffer;
/** createBuffer with GPUBufferUsage.UNIFORM OR'd in. */
export function createUniformBuffer(gpu: GPU, options: CreateBufferOptions): GPUBuffer;
export function createBuffer(gpu: GPU, options: CreateBufferOptions): GPUBuffer;

// --- @utils/RenderUtils ----------------------------------------------------------
/**
 * Record a fullscreen color-only pass drawing `geometry` (gpu.TRIANGLE, or
 * gpu.QUAD) through `pipeline` into `targetView`. Pass the RenderPipeline
 * WRAPPER, not the raw .pipeline — blit reads `.hasDynamicUniform` to bind
 * group(0) with the right dynamic-offset count.
 */
export function blit(
    encoder: GPUCommandEncoder,
    options: {
        pipeline: RenderPipeline;
        geometry: Geometry;
        targetView: GPUTextureView;
        bindGroup: GPUBindGroup;
        clear?: boolean;
        label?: string;
    }
): void;

// --- @utils/IBLUtils/IBLUtils ------------------------------------------------
/** Result of loadIBLCubeMap: GGX-prefiltered specular cube. */
export interface IBLCubeMap {
    texture: GPUTexture;
    /** `dimension: 'cube'` view. */
    view: GPUTextureView;
    /** Mip count — feed back to pbr.wgsl as the `roughnessLevels` override constant. */
    mipLevels: number;
    faceSize: number;
}

/** Load an .exr/.hdr/.ktx(2) environment (equirect or octahedral) and GGX-prefilter it. */
export function loadIBLCubeMap(gpu: GPU, options: { url: string; faceSize?: number; mipLevels?: number | null; label?: string }): Promise<IBLCubeMap>;
/** Load SH coefficients JSON → vec4-padded Float32Array, upload-ready for a buffer. */
export function loadSphericalHarmonics(url: string): Promise<Float32Array>;
/** Split-sum BRDF integration LUT (rg = scale/bias). One compute dispatch. */
export function createBrdfLUT(gpu: GPU, options?: { size?: number; label?: string }): GPUTexture;

// --- @utils/JSONLoader ---------------------------------------------------------
export function loadJSON<T = any>(url: string, opts?: RequestInit): Promise<T>;
export function loadJSONAll<T = any>(urls: string[], opts?: RequestInit): Promise<T[]>;

// --- @utils/TimingHelper -------------------------------------------------------
/** GPU pass timing via timestamp queries; inert (returns 0) without 'timestamp-query'. */
export class TimingHelper {
    constructor(device: GPUDevice);
    beginRenderPass(encoder: GPUCommandEncoder, descriptor?: GPURenderPassDescriptor): GPURenderPassEncoder;
    beginComputePass(encoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
    /** Pass duration in nanoseconds (after the command buffer is submitted). */
    getResult(): Promise<number>;
}

// --- @utils/wgslOverrides ------------------------------------------------------
/**
 * Bake `override` declarations into module-scope `const` literals before
 * compile (Safari lacks pipeline-overridable constants).
 */
export function applyOverrideConstants(code: string, constants?: Record<string, number | boolean>): string;

// --- @utils/ktxutils (not in the package barrel; import via @utils/ktxutils) ---
export interface KTXBlockInfo {
    blockW: number;
    blockH: number;
    blockBytes: number;
}
export function formatBlockInfo(format: GPUTextureFormat | string): KTXBlockInfo | undefined;
export function parseKTXHeader(u8: Uint8Array): { width: number; height: number; levels: number; format: GPUTextureFormat | null; [key: string]: unknown };
export function vkFormatToWebGPU(fmt: number): GPUTextureFormat | undefined;
export function glFormatToWebGPU(fmt: number): GPUTextureFormat | undefined;

// --- @utils/Mat3Utils / Mat4Utils / EulerUtils (not in the barrel) --------------
/** Adjugate of a Mat4's upper 3x3 into dstMat (normal-matrix helper). */
export function adjugate(m: ArrayLike<number>, dstMat: Mat3 | Float32Array): Mat3 | Float32Array;
export function compose(dstMat: Mat4 | Float32Array, srcRotation: ArrayLike<number>, srcTranslation: ArrayLike<number>, srcScale: ArrayLike<number>): Mat4 | Float32Array;
export function decompose(srcMat: ArrayLike<number>, dstRotation: Quat | Float32Array, dstTranslation: Vec3 | Float32Array, dstScale: Vec3 | Float32Array): void;
/** Rotation matrix → Euler angles (assumes unscaled upper 3x3). */
export function fromRotationMatrix(m: ArrayLike<number>, order?: string, out?: Euler | Float32Array): Euler | Float32Array;

// --- @utils/miscutils / @utils/utils (not in the barrel) ------------------------
export class NonNegativeRollingAverage {
    constructor(numSamples?: number);
    addSample(v: number): void;
    get(): number;
}
/** A Promise with `.resolve`/`.reject` exposed on the instance. */
export function getPromise<T = void>(): Promise<T> & { resolve: (value: T) => void; reject: (reason?: unknown) => void };

// =============================================================================
// Ambient module mappings keyed by the Vite import aliases used in the engine.
// These re-export the declarations above so `import { X } from '@core/...'`
// type-checks from a TS consumer.
// =============================================================================

declare module '@core/Renderer' {
    export { Renderer, RendererOptions, RenderOptions, UpdateArgs };
}
declare module '@core/Transform' {
    export { Transform };
}
declare module '@core/Camera' {
    export { Camera, CameraOptions };
}
declare module '@core/Mesh' {
    export { Mesh, MeshOptions, DrawArgs, UniformResource };
}
declare module '@core/RenderPipeline' {
    export { RenderPipeline, RenderPipelineOptions, BlendingOptions };
}
declare module '@core/PerDrawBuffer' {
    export { PerDrawBuffer };
}
declare module '@core/Geometry' {
    export { Geometry, GeometryOptions, GeometryData };
}
declare module '@core/ComputeShader' {
    export { ComputeShader, ComputeShaderOptions, DispatchOptions };
}
declare module '@core/Texture' {
    export { Texture, TextureOptions };
}
declare module '@core/RenderTarget' {
    export { RenderTarget, RenderTargetOptions, RenderTargetTextureSpec };
}
declare module '@core/GPUEnums' {
    export {
        TextureFormat,
        VertexFormat,
        AlphaMode,
        BlendFactor,
        BlendOperation,
        CompareFunction,
        StencilOperation,
        PrimitiveTopology,
        FrontFace,
        CullMode,
        IndexFormat,
        VertexStepMode,
        LoadOp,
        StoreOp,
        AddressMode,
        FilterMode,
        MipmapFilterMode,
        TextureDimension,
        TextureViewDimension,
        TextureAspect,
        BufferBindingType,
        SamplerBindingType,
        TextureSampleType,
        StorageTextureAccess,
        AutoLayoutMode,
        CanvasToneMappingMode,
        QueryType,
        PowerPreference,
        BufferMapState,
        DeviceLostReason,
        ErrorFilter,
        CompilationMessageType,
        PipelineErrorReason,
        FeatureName,
    };
}
declare module '@core/ShaderReload' {
    export { registerShader };
}
declare module '@core/skin/Skin' {
    export { Skin, SkinData };
}
declare module '@core/primitives' {
    export { Box, Sphere, Plane, Torus, Cylinder, Disc, Cone, Quad, FullscreenTriangle, PrimitiveOptions };
}
declare module '@math' {
    export { Vec2, Vec3, Vec4, Quat, Mat3, Mat4, Euler, Color };
}
declare module '@modules/Orbit' {
    export { Orbit, OrbitOptions, OrbitControls };
}
declare module '@modules/Raycast' {
    export { Raycast, RaycastIntersectOptions };
}
declare module '@modules/GUI' {
    export { GUI, GUIOptions, UniformTarget };
}
declare module '@modules/Animation' {
    export { Animation, AnimationOptions, AnimationData, AnimationFrame };
}
declare module '@modules/GLTFLoader' {
    export { GLTFLoader, GLTFLoaderOptions, GLTFGeometryData, IBLResources };
}
declare module '@modules/CubeMap' {
    export { CubeMap, CubeMapOptions };
}
declare module '@modules/VideoTexture' {
    export { VideoTexture, VideoTextureOptions };
}
declare module '@modules/KTXTexture' {
    export { KTXTexture, KTXTextureOptions };
}
declare module '@utils/BufferUtils' {
    export { createStorageBuffer, createUniformBuffer, createBuffer, CreateBufferOptions };
}
declare module '@utils/RenderUtils' {
    export { blit };
}
declare module '@utils/IBLUtils/IBLUtils' {
    export { loadIBLCubeMap, loadSphericalHarmonics, createBrdfLUT, IBLCubeMap };
}
declare module '@utils/JSONLoader' {
    export { loadJSON, loadJSONAll };
}
declare module '@utils/TimingHelper' {
    export { TimingHelper };
}
declare module '@utils/wgslOverrides' {
    export { applyOverrideConstants };
}
declare module '@utils/ktxutils' {
    export { formatBlockInfo, parseKTXHeader, vkFormatToWebGPU, glFormatToWebGPU, KTXBlockInfo };
}
declare module '@utils/Mat3Utils' {
    export { adjugate };
}
declare module '@utils/Mat4Utils' {
    export { compose, decompose };
}
declare module '@utils/EulerUtils' {
    export { fromRotationMatrix };
}
declare module '@utils/miscutils' {
    export { NonNegativeRollingAverage };
}
declare module '@utils/utils' {
    export { getPromise };
}

// WGSL `?raw` imports resolve to strings.
declare module '*.wgsl?raw' {
    const src: string;
    export default src;
}
