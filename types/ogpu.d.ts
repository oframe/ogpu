/**
 * ogpu.d.ts — ambient TypeScript declarations for the OGPU WebGPU engine.
 *
 * This is a HAND-WRITTEN scaffold describing the public API surface of the
 * hand-rolled vanilla-JS engine. It exists so the framework can later be
 * migrated to TS, or consumed from a TS project, without rewriting the source.
 *
 * HOW TO USE
 * ----------
 * The engine is authored in plain JS and imported via Vite path aliases
 * (`@core/*`, `@modules/*`, …). To make those imports type-check from a TS
 * consumer, point your tsconfig at this file and (ideally) mirror the aliases:
 *
 *   {
 *     "compilerOptions": {
 *       "types": ["@webgpu/types"],
 *       "typeRoots": ["./node_modules/@types", "./types"],
 *       // mirror vite.config.js aliases so the `declare module` blocks below resolve:
 *       "baseUrl": ".",
 *       "paths": {
 *         "@core/*":    ["src/core/*"],
 *         "@modules/*": ["src/modules/*"],
 *         "@utils/*":   ["src/utils/*"],
 *         "@examples/*":["examples/*"],
 *         "@/*":        ["src/*"]
 *       }
 *     },
 *     "include": ["src", "types/ogpu.d.ts"]
 *   }
 *
 * Or simply add this file to `files`/`include` and reference the ambient
 * module names declared below.
 *
 * Assumes the WebGPU lib types (`GPUDevice`, `GPUTexture`, …) are globally
 * available — install `@webgpu/types` and add it to `compilerOptions.types`,
 * or target a lib.dom that ships them.
 *
 * Scope: core classes, the math wrappers, and the most-used modules. Less-used
 * modules are stubbed. Search for `// TODO` for areas that are partial or
 * uncertain and worth tightening when migrating in earnest.
 *
 * NOTE: every declaration here is derived from the actual source in `src/`.
 */

// =============================================================================
// Shared / utility types
// =============================================================================

/**
 * The augmented canvas context that the engine threads through nearly every
 * constructor. It is a `GPUCanvasContext` with `.device`, `.presentationFormat`
 * and a back-reference `.renderer` attached. Most classes take THIS object,
 * never the raw `GPUDevice`.
 */
export interface GPU extends GPUCanvasContext {
    device: GPUDevice;
    presentationFormat: GPUTextureFormat;
    renderer: Renderer;
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
 * A reflected, structured uniform view (from webgpu-utils' makeStructuredView).
 * `views` maps each declared struct field to a typed-array view over
 * `arrayBuffer`; `set(obj)` writes by field name. // TODO: tighten field types.
 */
export interface StructuredView {
    arrayBuffer: ArrayBuffer;
    views: Record<string, Float32Array | Uint32Array | Int32Array>;
    set(values: Record<string, unknown>): void;
}

// =============================================================================
// @core/math — chainable Float32Array math wrappers over wgpu-matrix
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
    applyMat3(m: ArrayLike<number>): this;
    dot(v: ArrayLike<number>): number;
    len(): number;
    lenSq(): number;
    distance(v: ArrayLike<number>): number;
    equals(v: ArrayLike<number>): boolean;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    /** OGL-name alias for `lenSq`. */
    squaredLen(): number;
    // TODO: verify full Vec2 method list against src/core/math/Vec2.js
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
    scale(s: number): this;
    /** three.js-style alias for `scale`. */
    multiplyScalar(s: number): this;
    normalize(): this;
    dot(v: ArrayLike<number>): number;
    len(): number;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    // --- OGL-name aliases ---
    applyMatrix4(m: ArrayLike<number>): this;
    squaredLen(): number;
    squaredDistance(v: ArrayLike<number>): number;
    // TODO: verify full Vec4 method list against src/core/math/Vec4.js
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
    set(...values: number[]): this;
    copy(m: ArrayLike<number>): this;
    clone(): Mat3;
    identity(): this;
    multiply(m: ArrayLike<number>): this;
    invert(): this;
    transpose(): this;
    /** Build the (inverse-transpose) normal matrix from a Mat4 world matrix. */
    fromNormalMatrix(m: ArrayLike<number>): this;
    fromArray(a: ArrayLike<number>, o?: number): this;
    toArray(a?: number[], o?: number): number[];
    // TODO: verify full Mat3 method list against src/core/math/Mat3.js
}

export class Mat4 extends Float32Array {
    constructor();
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
    setFromQuaternion(q: ArrayLike<number>, order?: string): this;
    setFromRotationMatrix(m: ArrayLike<number>, order?: string): this;
    /** Re-express the same orientation under a new rotation order (OGL parity). */
    reorder(order: string): this;
    // TODO: verify full Euler method list against src/core/math/Euler.js
}

/** OGL-style linear RGB color (r, g, b in 0..1). */
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
}

// =============================================================================
// @core/Geometry — wraps webgpu-utils buffer/attribute creation.
// =============================================================================

/**
 * webgpu-utils attribute arrays. Each entry is a typed array or a descriptor
 * `{ data, numComponents }`. // TODO: tighten to webgpu-utils' Arrays type.
 */
export type GeometryData = Record<string, ArrayLike<number> | { data: ArrayLike<number>; numComponents?: number }>;

export interface GeometryOptions {
    data?: GeometryData;
    instancedData?: GeometryData;
    interleave?: boolean;
}

export class Geometry {
    constructor(gpu: GPU, options?: GeometryOptions);
    attributes: GeometryData;
    nonInstancedVerts: any; // webgpu-utils BuffersAndAttributes. // TODO
    instancedVerts: any; // {} when not instanced. // TODO
    instanced: boolean;
    bufferLayouts: GPUVertexBufferLayout[];
    numBuffers: number;
    bounds?: Bounds;
    /** Set to 'sphere' to prefer sphere over AABB in Raycast. */
    raycast?: 'sphere';

    computeBoundingBox(attr?: { data: ArrayLike<number>; stride: number }): Bounds | null;
    computeBoundingSphere(attr?: { data: ArrayLike<number>; stride: number }): Bounds | null;
    destroy(): void;
}

// =============================================================================
// @core/RenderPipeline — wraps GPURenderPipeline; owns uniform buffer + groups.
// =============================================================================

/** Blend descriptors per GPUBlendState. */
export interface BlendingOptions {
    color?: GPUBlendComponent;
    alpha?: GPUBlendComponent;
}

export interface RenderPipelineOptions {
    label?: string;
    /** Raw WGSL source. Must declare `vs`/`fs` entry points and a `uniforms` struct. */
    code: string;
    geometry: Geometry;
    targets?: GPUColorTargetState[];
    depthTest?: boolean;
    depthWrite?: boolean;
    depthStencil?: boolean;
    transparent?: boolean;
    cullMode?: GPUCullMode;
    topology?: GPUPrimitiveTopology;
    blending?: BlendingOptions;
    sampleCount?: number;
    /** Override constants, baked into source (Safari-safe). */
    constants?: Record<string, number>;
}

export interface CreateBindGroupOptions {
    index?: number;
    entries: GPUBindGroupEntry[];
    label?: string;
}

export class RenderPipeline {
    constructor(gpu: GPU, options: RenderPipelineOptions);
    label: string;
    gpu: GPU;
    id: number;
    geometry: Geometry;
    code: string;
    module: GPUShaderModule;
    defs: any; // makeShaderDataDefinitions result. // TODO
    pipeline: GPURenderPipeline;
    /** Reflected uniform struct view. Call `.set({...})` then uploadUniforms(). */
    uniforms: StructuredView;
    uniformBuffer: GPUBuffer;
    bindGroups: GPUBindGroup[];
    bindGroupEntries: GPUBindGroupEntry[][];
    bindGroupLabels: string[];
    depthTest: boolean;
    depthWrite: boolean;
    depthStencil: boolean;
    transparent: boolean;
    cullMode: GPUCullMode;

    /** Rebuild the pipeline from fresh WGSL (hot-reload entry point). */
    reload(code: string): void;
    /** Recompile + recreate the GPURenderPipeline from `code`. */
    build(code: string): void;
    createBindGroup(options: CreateBindGroupOptions): GPUBindGroup;
    uploadUniforms(): void;
    /** Rebuild one group (pass {index}) or all (omit) from stored entries. */
    updateBindgroup(options?: { index?: number | null; entries?: GPUBindGroupEntry[] | null }): GPUBindGroup | void;
    updateBindgroups(): void;
    destroy(): void;
}

// =============================================================================
// @core/Mesh — ties a pipeline + geometry; writes standard per-frame uniforms.
// =============================================================================

export interface MeshOptions {
    label?: string;
    pipeline: RenderPipeline;
    manualRender?: boolean;
    renderOrder?: number;
    /** GPUBuffer for drawIndirect / drawIndexedIndirect. */
    drawBuffer?: GPUBuffer | null;
    frustumCulled?: boolean;
}

export interface DrawArgs {
    camera?: Camera | null;
    pass: GPURenderPassEncoder;
    time?: number;
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
    drawBuffer: GPUBuffer | null;
    modelViewMatrix: Mat4;
    normalMatrix: Mat3;
    objectMatrix: Mat4;
    /** Set by Renderer.getRenderQueue for sorting. */
    zDepth?: number;
    /** Reused result object populated by Raycast. // TODO: type the hit shape. */
    hit?: any;

    onBeforeRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    onAfterRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    draw(args: DrawArgs): void;
}

// =============================================================================
// @core/ComputeShader — wraps a compute module; one pipeline per entry point.
// =============================================================================

export interface ComputeShaderOptions {
    label?: string;
    /** Raw WGSL. Every entry point becomes a kernel keyed by its name. */
    code: string;
    layout?: GPUPipelineLayout | 'auto';
    constants?: Record<string, number>;
    size?: number;
}

export interface ComputeCreateBindGroupOptions {
    label?: string;
    kernel: GPUComputePipeline;
    layout?: GPUBindGroupLayout;
    entries?: GPUBindGroupEntry[];
    groupIndex?: number;
    key?: string;
}

export interface DispatchOptions {
    pass?: GPUComputePassEncoder | null;
    kernel: GPUComputePipeline;
    bindGroup: GPUBindGroup;
    bindGroupIndex?: number;
    /** [x, y?, z?] workgroup counts. */
    dispatchCount: number[];
    /** Pass a buffer to use dispatchWorkgroupsIndirect instead. */
    workgroupBuffer?: GPUBuffer | null;
    timing?: boolean;
}

export class ComputeShader {
    constructor(gpu: GPU, options: ComputeShaderOptions);
    label: string;
    gpu: GPU;
    code: string;
    module: GPUShaderModule;
    defs: any; // makeShaderDataDefinitions result. // TODO
    /** Map of entry-point name -> compute pipeline. Reference stays stable across reloads. */
    kernels: Record<string, GPUComputePipeline>;
    bindGroups: Record<string, GPUBindGroup>;
    bindGroupRecords: Record<string, unknown>;

    reload(code: string): void;
    build(code: string): void;
    isValidKernel(key: string): boolean;
    findKernel(key: string): GPUComputePipeline | undefined;
    createBindGroup(options: ComputeCreateBindGroupOptions): GPUBindGroup;
    updateBindgroup(options?: { key?: string | null; entries?: GPUBindGroupEntry[] | null }): GPUBindGroup | void;
    updateBindgroups(): void;
    dispatch(encoder: GPUCommandEncoder, options: DispatchOptions): Promise<void>;
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
    src?: string | string[] | ImageBitmap | ImageBitmap[] | null;
    flipY?: boolean;
}

export class Texture {
    constructor(gpu: GPU, options?: TextureOptions);
    gpu: GPU;
    id: number;
    label: string;
    texture: GPUTexture | null;
    width: number;
    height: number;
    depth: number;
    format: GPUTextureFormat;
    dimension: GPUTextureDimension;
    usage: GPUTextureUsageFlags;
    sampleCount: number;
    mipLevelCount: number;
    isCubeMap: boolean;
    isDestroyed: boolean;
    /** Resolves to `this` once the (possibly async) texture is created. */
    ready: Promise<this>;

    update(options?: TextureOptions): void;
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
    /** Create an owned depth texture. */
    depthTexture?: boolean;
    sampleCount?: number;
    generateMipmaps?: boolean;
    mipLevelCount?: number;
    usage?: GPUTextureUsageFlags;
    label?: string;
}

/** Exported as `RenderTarget` from @core/RenderTarget. */
export class RenderTarget {
    constructor(gpu: GPU, options?: RenderTargetOptions, textures?: RenderTargetTextureSpec[]);
    gpu: GPU;
    label: string;
    width: number;
    height: number;
    depth: number;
    sampleCount: number;
    /** Color attachments (textures[0] is the primary). */
    textures: Texture[];
    /** Primary color texture (alias of textures[0]). */
    texture: Texture;
    msaaTextures: Texture[];
    /** Present only when constructed with depthTexture: true. */
    depthTexture?: GPUTexture;

    createTextures(): void;
    createDepthTexture(): void;
    /** Array of `{ format }` for RenderPipeline's `targets`. */
    getTargets(): GPUColorTargetState[];
    onResize(size: { width: number; height: number; depth?: number }): void;
}

// =============================================================================
// @core/skin/Skin — GPU skinning compute pass.
// =============================================================================

/** Rig + geometry data shape that Skin consumes (built by GLTFLoader). // TODO: tighten. */
export interface SkinData {
    position: ArrayLike<number>;
    normal: ArrayLike<number>;
    skinWeight: ArrayLike<number>;
    skinIndex: ArrayLike<number>;
    rig: any;
}

export class Skin {
    constructor(gpu: GPU, options: { label?: string; data: SkinData });
    gpu: GPU;
    label: string;
    rig: any;
    root: Transform;
    bones: Transform[];
    animations: Map<string, Animation>;
    threadCount: number;
    /** Skinned output storage buffers consumed by the render pipeline. */
    skinnedPositionBuffer: GPUBuffer;
    skinnedNormalBuffer: GPUBuffer;
    boneMatrixBuffer: GPUBuffer;
    skinner: ComputeShader;

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
// @core/Renderer — owns device, context, depth texture, RAF frame loop, render queue.
// =============================================================================

export interface RendererOptions {
    canvas?: HTMLCanvasElement | null;
    dpr?: number | null;
    transparent?: boolean;
    depth?: boolean;
    stencil?: boolean;
}

export interface RenderOptions {
    scene: Transform;
    camera?: Camera;
    /** null → draw to the swapchain. */
    target?: RenderTarget | null;
    loadOp?: GPULoadOp;
    storeOp?: GPUStoreOp;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
    timing?: boolean;
    /** Chain multiple passes into one submit by passing a shared encoder. */
    encoder?: GPUCommandEncoder | null;
    frustumCull?: boolean;
    /** Refresh camera/scene world matrices this frame (default true). Set false
     * for a static scene or when you've already posed it yourself. */
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
    depth: boolean;
    stencil: boolean;
    transparent: boolean;
    clearColor: ClearColor;
    time: number;
    deltaTime: number;
    prevTime: number;
    paused: boolean;
    isReady: boolean;
    /** `await renderer.ready` before touching the device/context. */
    ready: Promise<void>;
    /** The augmented canvas context (`.device`, `.presentationFormat`, `.renderer`). */
    gpu: GPU;
    presentationFormat: GPUTextureFormat;
    depthTexture?: GPUTexture;
    renderQueue?: Mesh[];

    /** Register a per-frame callback (called each frame). */
    add(cb: (args: UpdateArgs) => void): void;
    remove(cb: (args: UpdateArgs) => void): void;
    pause(): void;
    resume(): void;
    setClearColor(color?: Partial<ClearColor>): void;
    /** Register an async setup promise for the boot overlay to wait on. */
    trackCompile(promise: Promise<unknown>): void;
    createDepthTexture(): void;
    updateClock(time?: number): void;
    getRenderQueue(options: { scene: Transform; camera?: Camera; sort?: boolean; frustumCull?: boolean }): Mesh[];
    render(options: RenderOptions): void;
}

// =============================================================================
// Modules (@modules/*) — higher-level / optional pieces. Most-used covered;
// the rest are stubbed below.
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
    remove(): void;
    // TODO: flesh out remaining instance members from src/modules/Orbit.js
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
    castMouse(camera: Camera, mouse?: [number, number]): this;
    /** Fast sphere/AABB test; returns hit meshes sorted near→far. */
    intersectBounds(meshes: Mesh[], options?: { maxDistance?: number; output?: Mesh[] }): Mesh[];
    /** Exact CPU triangle test; populates each mesh's `.hit`. */
    intersectMeshes(meshes: Mesh[], options?: RaycastIntersectOptions): Mesh[];
    intersectPlane(plane: any, origin?: Vec3, direction?: Vec3, out?: Vec3 | null): Vec3 | null;
    intersectSphere(sphere: any, origin?: Vec3, direction?: Vec3): number;
    intersectBox(box: any, origin?: Vec3, direction?: Vec3): number;
    intersectTriangle(a: Vec3, b: Vec3, c: Vec3, /* ... */ ...rest: any[]): number;
    getBarycoord(point: Vec3, a: Vec3, b: Vec3, c: Vec3, target?: Vec3): Vec3;
    // TODO: tighten plane/sphere/box arg shapes against src/modules/Raycast.js
}

// --- @modules/GUI (thin Tweakpane wrapper) -----------------------------------
export interface GUIOptions {
    title?: string;
    expanded?: boolean;
    container?: HTMLElement;
    /** A FolderApi when nesting (used internally by folder()). */
    pane?: unknown;
}

export class GUI {
    constructor(options?: GUIOptions);
    /** The raw Tweakpane Pane/FolderApi for anything not wrapped here. */
    pane: any; // tweakpane Pane. // TODO: import('tweakpane').Pane
    /** Bind a property; returns the Tweakpane binding. */
    add(obj: object, key: string, opts?: Record<string, unknown>): any;
    /** Read-only readout (e.g. fps). */
    monitor(obj: object, key: string, opts?: Record<string, unknown>): any;
    button(title: string, onClick: () => void): any;
    /** Returns a GUI scoped to a sub-folder. */
    folder(title: string, opts?: { expanded?: boolean }): GUI;
    /** Bind a RenderPipeline uniform; writes + re-uploads on change. */
    uniform(pipeline: RenderPipeline, key: string, opts?: Record<string, unknown>): any;
    dispose(): void;
}

// --- @modules/Animation (keyframe playback over a list of Transforms) --------
export interface AnimationOptions {
    transforms?: Transform[];
    label?: string;
    /** Baked keyframe data ({ frames, ... }). // TODO: tighten shape. */
    data?: any;
    loop?: boolean;
}

export class Animation {
    constructor(options?: AnimationOptions);
    label: string;
    loop: boolean;
    elapsed: number;
    duration: number;
    weight: number;
    data: any;
    /** Set playback fps. */
    fps(value: number): void;
    /** Advance + write to the driven transforms. `isSet` resets accumulated pose. */
    update(totalWeight?: number, isSet?: boolean): void;
}

// --- @modules/GLTFLoader -----------------------------------------------------
export interface GLTFLoaderOptions {
    /** PBR shader WGSL. Required unless dataOnly. */
    code?: string;
    iblEntries?: GPUBindGroupEntry[];
    targets?: GPUColorTargetState[] | null;
    sampleCount?: number;
    /** Parse geometry/skin/animation only — no pipelines/materials/textures. */
    dataOnly?: boolean;
}

export class GLTFLoader {
    constructor(gpu: GPU, options?: GLTFLoaderOptions);
    gpu: GPU;
    dataOnly: boolean;
    meshes: Mesh[];
    pipelines: RenderPipeline[];
    /** Parsed rigs (one per glTF skin), shaped for @core/skin/Skin. */
    skins: Array<{ rig: any }>;
    animations: any[];
    skinnedMeshes: Mesh[];
    /** The built scene graph (also returned by load()). */
    scene?: Transform;
    json?: any;

    /** Fetch + parse a .gltf/.glb, returning the scene graph. */
    load(url: string): Promise<Transform>;
    /** Build a Skin from a parsed skinned mesh. */
    getSkinData(meshOrIndex?: Mesh | number): Skin;
    /** Resample a parsed animation to uniform frames and wrap in an Animation. */
    getAnimation(options?: { animation?: number; skin?: number; fps?: number }): Animation;
}

// =============================================================================
// Ambient module mappings keyed by the Vite import aliases used in the engine.
// These re-export the classes declared above so `import { X } from '@core/...'`
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
    export { Mesh, MeshOptions, DrawArgs };
}
declare module '@core/RenderPipeline' {
    export { RenderPipeline, RenderPipelineOptions, CreateBindGroupOptions };
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
    export { RenderTarget, RenderTargetOptions };
}
declare module '@core/skin/Skin' {
    export { Skin, SkinData };
}
declare module '@core/math' {
    export { Vec2, Vec3, Vec4, Quat, Mat3, Mat4, Euler, Color };
}
declare module '@modules/Orbit' {
    export { Orbit, OrbitOptions, OrbitControls };
}
declare module '@modules/Raycast' {
    export { Raycast, RaycastIntersectOptions };
}
declare module '@modules/GUI' {
    export { GUI, GUIOptions };
}
declare module '@modules/Animation' {
    export { Animation, AnimationOptions };
}
declare module '@modules/GLTFLoader' {
    export { GLTFLoader, GLTFLoaderOptions };
}

// WGSL `?raw` imports resolve to strings.
declare module '*.wgsl?raw' {
    const src: string;
    export default src;
}
