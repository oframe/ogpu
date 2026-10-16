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
 * the real type is an engine internal (geometry buffer bundles).
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
 * A reflected WGSL type definition (from `reflect()`): an intrinsic
 * (`{ size, type }`), an array (`{ size, elementType, numElements }`, 0 =
 * runtime-sized) or a struct (`{ size, fields: { name: { offset, type } } }`).
 */
export interface ReflectedType {
    size: number;
    type?: string;
    elementType?: ReflectedType;
    numElements?: number;
    fields?: Record<string, { offset: number; type: ReflectedType }>;
    offset?: number;
}

/** A reflected module-scope variable (`defs.uniforms.<name>`, `defs.storages.<name>`, …). */
export interface ReflectedVariable {
    typeDefinition: ReflectedType;
    group: number;
    binding: number;
    size: number;
}

/** Entry-point info from `reflect()`; `stage` is a GPUShaderStage bit. */
export interface ReflectedEntryPoint {
    stage: number;
    inputs: Array<{ name: string; location: number }>;
    resources: Array<{ name: string; group: number; entry: GPUBindGroupLayoutEntry }>;
}

/** Result of `reflect(wgsl)` (webgpu-utils' makeShaderDataDefinitions + `inputs`) — the data definitions Shader/RenderPipeline/ComputeShader read. */
export interface ShaderDefs {
    structs: Record<string, ReflectedType>;
    uniforms: Record<string, ReflectedVariable>;
    storages: Record<string, ReflectedVariable>;
    storageTextures: Record<string, ReflectedVariable>;
    textures: Record<string, ReflectedVariable>;
    externalTextures: Record<string, ReflectedVariable>;
    samplers: Record<string, ReflectedVariable>;
    immediates: Record<string, ReflectedVariable>;
    entryPoints: Record<string, ReflectedEntryPoint>;
}

/**
 * Named typed-array views over one ArrayBuffer, laid out by a reflected WGSL
 * type. `views` maps each struct field to a typed array (scalars are length 1;
 * an array of intrinsics is one flat typed array; an array of structs is a JS
 * array of view objects; f16 scalars are Uint16Array raw bits, f16 vectors and
 * matrices Float16Array — raw bits again, in a Uint16Array subclass, where the
 * browser has no Float16Array (Chrome/Edge < 135; warned once); built by
 * webgpu-utils' makeTypedArrayViews); `set(obj)` writes by field name.
 * // TODO: tighten field types.
 */
export class StructView {
    /** `def`: a reflected variable or a type/struct definition. Pass `arrayBuffer` for runtime-sized arrays. */
    constructor(def: ReflectedVariable | ReflectedType, arrayBuffer?: ArrayBuffer, byteOffset?: number);
    type: ReflectedType;
    arrayBuffer: ArrayBuffer;
    views: Record<string, any>;
    set(values: Record<string, unknown>): this;
}

/** Same as `new StructView(def, arrayBuffer, byteOffset)`. */
export function makeStructuredView(def: ReflectedVariable | ReflectedType, arrayBuffer?: ArrayBuffer, byteOffset?: number): StructView;

/** WGSL source -> data definitions (structs, uniforms, storages, textures, samplers, entry points). */
export function reflect(code: string): ShaderDefs;

// =============================================================================
// @math — chainable Float32Array math classes
// =============================================================================
// Each subclasses Float32Array, so any instance is a drop-in arg to the
// function layer below. Methods mutate `this` and return `this` for chaining.

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
    /** Shortest-arc rotation between two unit vectors (antiparallel-safe). */
    setFromUnitVectors(from: ArrayLike<number>, to: ArrayLike<number>): this;
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
// @math/functions — the function layer under the classes (also re-exported
// from '@math' and 'ogpu'): wgpu-matrix 3.4.2 plus local overrides.
// Column-major; mat3 is 12 floats (3 columns × vec4). `out` is last and
// optional: allocated as a Float32Array when omitted, always returned, and may
// alias any input. Lanes are written by index, so a plain-array `out` of any
// length works — except that only mat3.set/fromMat4 write mat3's padding lanes
// (3, 7, 11): the other mat3 ops leave them, so an empty plain-array `out` comes
// back 11 long with holes.
// =============================================================================

type NumArray = ArrayLike<number>;
type OutArray = Float32Array | number[];

interface VecOps<N extends Float32Array> {
    add<T extends OutArray = N>(a: NumArray, b: NumArray, out?: T): T;
    subtract<T extends OutArray = N>(a: NumArray, b: NumArray, out?: T): T;
    multiply<T extends OutArray = N>(a: NumArray, b: NumArray, out?: T): T;
    scale<T extends OutArray = N>(v: NumArray, k: number, out?: T): T;
    negate<T extends OutArray = N>(v: NumArray, out?: T): T;
    lerp<T extends OutArray = N>(a: NumArray, b: NumArray, t: number, out?: T): T;
    /** Zero-length input stays zero. */
    normalize<T extends OutArray = N>(v: NumArray, out?: T): T;
    dot(a: NumArray, b: NumArray): number;
    length(v: NumArray): number;
    lengthSq(v: NumArray): number;
    distance(a: NumArray, b: NumArray): number;
}

interface VecOpsExt<N extends Float32Array> extends VecOps<N> {
    addScaled<T extends OutArray = N>(a: NumArray, b: NumArray, k: number, out?: T): T;
    min<T extends OutArray = N>(a: NumArray, b: NumArray, out?: T): T;
    max<T extends OutArray = N>(a: NumArray, b: NumArray, out?: T): T;
    distanceSq(a: NumArray, b: NumArray): number;
}

export const vec2: VecOps<Float32Array>;

export const vec3: VecOpsExt<Float32Array> & {
    divide<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    cross<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    /** Radians; a zero-length input gives π/2. */
    angle(a: NumArray, b: NumArray): number;
    /** Point transform with divide by w (w of 0 treated as 1). */
    transformMat4<T extends OutArray = Float32Array>(v: NumArray, m: NumArray, out?: T): T;
    transformMat4Upper3x3<T extends OutArray = Float32Array>(v: NumArray, m: NumArray, out?: T): T;
    /** m is a 12-float mat3. */
    transformMat3<T extends OutArray = Float32Array>(v: NumArray, m: NumArray, out?: T): T;
    transformQuat<T extends OutArray = Float32Array>(v: NumArray, q: NumArray, out?: T): T;
};

export const vec4: VecOpsExt<Float32Array> & {
    transformMat4<T extends OutArray = Float32Array>(v: NumArray, m: NumArray, out?: T): T;
};

export type EulerOrderLower = 'xyz' | 'xzy' | 'yxz' | 'yzx' | 'zxy' | 'zyx';

export const quat: {
    identity<T extends OutArray = Float32Array>(out?: T): T;
    /** a ⊗ b: applies b, then a. */
    mul<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    conjugate<T extends OutArray = Float32Array>(q: NumArray, out?: T): T;
    inverse<T extends OutArray = Float32Array>(q: NumArray, out?: T): T;
    /** Length ≤ 1e-5 gives identity. */
    normalize<T extends OutArray = Float32Array>(q: NumArray, out?: T): T;
    dot(a: NumArray, b: NumArray): number;
    length(q: NumArray): number;
    fromAxisAngle<T extends OutArray = Float32Array>(axis: NumArray, angle: number, out?: T): T;
    /** Order 'abc' = qa ⊗ qb ⊗ qc; throws on any other string. */
    fromEuler<T extends OutArray = Float32Array>(x: number, y: number, z: number, order: EulerOrderLower, out?: T): T;
    /** Rotation part of a mat4 or 12-float mat3. */
    fromMat<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    /** Antiparallel input returns a 180° turn (axis, 0), axis ⊥ a (x̂ × a, or ŷ × a when a ≈ ±x̂). */
    rotationTo<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    slerp<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, t: number, out?: T): T;
    rotateX<T extends OutArray = Float32Array>(q: NumArray, angle: number, out?: T): T;
    rotateY<T extends OutArray = Float32Array>(q: NumArray, angle: number, out?: T): T;
    rotateZ<T extends OutArray = Float32Array>(q: NumArray, angle: number, out?: T): T;
};

export const mat3: {
    set<T extends OutArray = Float32Array>(v0: number, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number, v7: number, v8: number, out?: T): T;
    /** A 16-float source gives its upper 3x3; the padding lanes (3, 7, 11) are left as they were. */
    copy<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    identity<T extends OutArray = Float32Array>(out?: T): T;
    fromMat4<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    multiply<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    inverse<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    transpose<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
};

export const mat4: {
    copy<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    identity<T extends OutArray = Float32Array>(out?: T): T;
    multiply<T extends OutArray = Float32Array>(a: NumArray, b: NumArray, out?: T): T;
    /** Singular input yields Inf/NaN. */
    inverse<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    determinant(m: NumArray): number;
    transpose<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    fromQuat<T extends OutArray = Float32Array>(q: NumArray, out?: T): T;
    translate<T extends OutArray = Float32Array>(m: NumArray, v: NumArray, out?: T): T;
    scale<T extends OutArray = Float32Array>(m: NumArray, v: NumArray, out?: T): T;
    rotateX<T extends OutArray = Float32Array>(m: NumArray, angle: number, out?: T): T;
    rotateY<T extends OutArray = Float32Array>(m: NumArray, angle: number, out?: T): T;
    rotateZ<T extends OutArray = Float32Array>(m: NumArray, angle: number, out?: T): T;
    /** Column 0–3 as a vec3 (3 = translation). */
    getAxis<T extends OutArray = Float32Array>(m: NumArray, axis: number, out?: T): T;
    getTranslation<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    getScaling<T extends OutArray = Float32Array>(m: NumArray, out?: T): T;
    /** Depth [near, far] -> [0, 1]; far may be Infinity. */
    perspective<T extends OutArray = Float32Array>(fovy: number, aspect: number, near: number, far: number, out?: T): T;
    /** Depth [near, far] -> [0, 1]. */
    ortho<T extends OutArray = Float32Array>(left: number, right: number, bottom: number, top: number, near: number, far: number, out?: T): T;
    /** View matrix (−Z forward). */
    lookAt<T extends OutArray = Float32Array>(eye: NumArray, target: NumArray, up: NumArray, out?: T): T;
    /** Object matrix (+Z toward target). */
    aim<T extends OutArray = Float32Array>(position: NumArray, target: NumArray, up: NumArray, out?: T): T;
};

// =============================================================================
// @core/Transform — scene-graph node. Everything renderable extends this.
// =============================================================================

export interface ScissorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class Transform {
    constructor();
    parent: Transform | null;
    children: Transform[];
    visible: boolean;
    label?: string;
    /**
     * Scissor rect in attachment pixels (device px on the canvas, texels on a RenderTarget), origin
     * top-left. Intersected with every ancestor's; a draw clipped to nothing is skipped. Default null.
     */
    scissor: ScissorRect | null;

    matrix: Mat4;
    worldMatrix: Mat4;
    matrixAutoUpdate: boolean;
    worldMatrixNeedsUpdate: boolean;
    /** Bumped whenever worldMatrix is recomputed; Mesh caches normal/object matrices against it. */
    worldVersion: number;
    /** Bumped on this node and every ancestor when a child is added or removed below. */
    structureVersion: number;

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
    /** Recomposes `matrix` (and dirties the world matrix) only when position/quaternion/scale changed since the last call. */
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
    updateMatrixWorld(force?: boolean): this;
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
// @core/Geometry — builds vertex/index buffers and layouts from attribute arrays.
// =============================================================================

/**
 * Attribute arrays keyed by name. Each entry is a typed array or a descriptor
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
    /** Byte offset of this geometry's args inside `drawBuffer` (default 0; a multiple of 4) — for packed indirect args shared by several geometries. */
    drawBufferOffset?: number;
    /**
     * Extra GPUBufferUsage flags OR'd into every vertex/instance buffer.
     * They are created VERTEX-only — pass GPUBufferUsage.COPY_DST
     * if you plan to queue.writeBuffer them at runtime.
     */
    usage?: GPUBufferUsageFlags;
}

export class Geometry {
    constructor(gpu: GPU, options: GeometryOptions);
    attributes: GeometryData;
    drawBuffer: GPUBuffer | null;
    /** Byte offset of the indirect args inside `drawBuffer`. */
    drawBufferOffset: number;
    /** `{ buffers, bufferLayouts, indexBuffer?, indexFormat?, numElements… }`. */
    nonInstancedVerts: any;
    /** Same shape as `nonInstancedVerts`; `{}` when not instanced. */
    instancedVerts: any;
    hasInstancedAttributes: boolean;
    /** True when the geometry has per-instance attributes or a drawBuffer. */
    readonly instanced: boolean;
    bufferLayouts: GPUVertexBufferLayout[];
    /** JSON of `bufferLayouts` — pipeline-cache key part; equal layouts share pipelines. */
    layoutKey: string;
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
// @core/primitives — Geometry subclasses wrapping the engine's shape generators.
// =============================================================================

/**
 * Shape options are forwarded to the matching vertex generator
 * (`createCubeVertices`, …, in core/primitives/vertices.js) (size, radius, subdivisions, …);
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
// @core/RenderPipeline — an explicit GPURenderPipeline for fullscreen passes and
// other non-Mesh draws (fixed geometry + fixed target). No engine block: callers
// own their uniform buffers and bind groups (bindGroupLayout(i).createBindGroup). Meshes
// use Shader + MeshState instead.
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
    defs: ShaderDefs;
    pipeline: GPURenderPipeline;
    depthTest: boolean;
    depthWrite: boolean;
    depthStencil: false | GPUDepthStencilState | Record<string, never>;
    transparent: boolean;
    cullMode: GPUCullMode;

    /** Recompile + recreate the GPURenderPipeline from `code`. */
    build(code: string): void;
    /**
     * The BindGroupLayout for `groupIndex` (default 0; raw layout at `.layout`) —
     * build bind groups with its createBindGroup, not pipeline.getBindGroupLayout.
     * Interned by shape, so bind groups built from it stay valid across a hot reload
     * that keeps the bindings.
     * Throws for a group the shader doesn't use.
     */
    bindGroupLayout(groupIndex?: number): BindGroupLayout;
    /** Hot-reload entry point. */
    reload(code: string): void;
    /** Unregisters from the hot-reload registry. */
    destroy(): void;
}

// =============================================================================
// @core/BindGroupLayout — a GPUBindGroupLayout plus its WGSL names. Handed out
// by Shader, RenderPipeline and ComputeShader; never constructed directly.
// =============================================================================

export class BindGroupLayout {
    /** The device it was created on (the intern cache is per device). */
    device: GPUDevice;
    /** The raw layout. Interned by shape: equal entries share one GPUBindGroupLayout. */
    layout: GPUBindGroupLayout;
    /** Descriptor entries, sorted by binding (frozen). A wrapped explicit layout has `{ binding }` stubs only. */
    readonly entries: readonly GPUBindGroupLayoutEntry[];
    /** WGSL name → binding number, for the bindings in this layout (frozen). */
    readonly names: Readonly<Record<string, number>>;
    /** Every name the module declares in this group, including names outside this layout. */
    readonly declared: readonly string[];
    /**
     * Owner label, used in errors and default bind-group labels. The engine object
     * is interned by shape + group + names + declared, so this is the first creator's label.
     */
    label: string;
    group: number;
    /**
     * A bind group from resources keyed by WGSL name. An undeclared name throws
     * (listing the declared ones); a declared name outside this layout is dropped,
     * so one object can feed every kernel's layout; a binding of this layout left
     * out, `undefined` or `null` throws (listing what it needs).
     * Allocates a new GPUBindGroup per call: build once, rebuild only when a resource changes.
     */
    createBindGroup(resources: Record<string, ShaderResource | null | undefined>, options?: { label?: string }): GPUBindGroup;
}

// =============================================================================
// @core/Shader — shader module + reflected interface (no geometry/targets/state).
// =============================================================================

export interface ShaderOptions {
    label?: string;
    /** Raw WGSL. Entry points `vs` and (optionally) `fs`; the engine block (camera/object at group(1), time at group(3)) is appended. */
    code: string;
    /** Override constants, baked into source (Safari-safe). */
    constants?: Record<string, number>;
}

/** Index of the bind group the engine owns (camera + object slots). Not in the barrel — import via `@core/Shader`. */
export const ENGINE_GROUP: 1;
/** Index of the engine's per-pass `time` group. Not in the barrel — import via `@core/Shader`. */
export const TIME_GROUP: 3;
/** `Shader.needs` bit: the user code reads `normalMatrix`. Import via `@core/Shader`. */
export const NEEDS_NORMAL: 1;
/** `Shader.needs` bit: the user code reads `objectMatrix`. Import via `@core/Shader`. */
export const NEEDS_OBJECT: 2;

/**
 * A resource for BindGroupLayout.createBindGroup: a UniformBuffer or GPUBuffer binds whole;
 * `{ buffer, offset, size }`, texture views, samplers and external textures
 * pass through.
 */
export type ShaderResource = UniformBuffer | GPUBuffer | GPUTextureView | GPUSampler | GPUExternalTexture | GPUBufferBinding;

export class Shader {
    constructor(gpu: GPU, options: ShaderOptions);
    gpu: GPU;
    label: string;
    id: number;
    /** Bumped on every (re)build; cached pipelines key on it. */
    version: number;
    code: string;
    module: GPUShaderModule;
    defs: ShaderDefs;
    /** Reflected struct of `var<uniform> uniforms`, or undefined — feed it to UniformBuffer. */
    uniforms: ReflectedVariable | undefined;
    hasFragment: boolean;
    /** The device this shader was built on; the pipeline cache refuses a shader from another (lost) device. */
    device: GPUDevice;
    /** NEEDS_NORMAL | NEEDS_OBJECT: a text check of the user code for `normalMatrix` / `objectMatrix` (comments count). Meshes compute and write only these. */
    needs: number;
    pipelineLayout: GPUPipelineLayout;

    /** (Re)compile in place; hot reload calls this. */
    build(code: string): void;
    /**
     * The BindGroupLayout of a user group (default 0): `shader.bindGroupLayout(0).createBindGroup({ uniforms, tMap })`.
     * Groups 1 and 3 (the engine's) throw, as does a group the module doesn't declare. A
     * declared group vs/fs never read is an empty layout that drops every name.
     */
    bindGroupLayout(group?: number): BindGroupLayout;
    reload(code: string): void;
    /** Unregisters from the hot-reload registry. */
    destroy(): void;
}

// =============================================================================
// @core/UniformBuffer — a StructView plus the GPUBuffer it uploads to.
// =============================================================================

export class UniformBuffer {
    /**
     * The one way to back a uniform struct. `struct` is a reflected struct:
     * `shader.uniforms`, `pipeline.defs.uniforms.x`, `computeShader.defs.uniforms.x`.
     */
    constructor(gpu: GPU, struct: ReflectedVariable | ReflectedType, values?: Record<string, unknown>, options?: { label?: string; usage?: GPUBufferUsageFlags });
    gpu: GPU;
    label: string;
    view: StructView;
    buffer: GPUBuffer;
    /** Shorthand for `view.views`. */
    readonly views: StructView['views'];
    /** Write `values` into the view and upload immediately. */
    set(values: Record<string, unknown>): this;
    /** Upload the view; call after writing `views` directly. */
    upload(): this;
    destroy(): void;
}

// =============================================================================
// @core/PipelineCache — renderer-owned GPURenderPipeline cache.
// =============================================================================

/** Stable pass descriptor from PipelineCache.passInfo. */
export interface PassInfo {
    colorFormats: GPUTextureFormat[];
    depthFormat: GPUTextureFormat | null | undefined;
    sampleCount: number;
    key: string;
    id: number;
}

export class PipelineCache {
    constructor(gpu: GPU);
    gpu: GPU;
    /** Bumped by clear() (device restore) and when a key fails validation asynchronously; per-mesh memos and RecordedGroup bundles from before are stale. */
    generation: number;

    passInfo(colorFormats: GPUTextureFormat[], depthFormat: GPUTextureFormat | null | undefined, sampleCount: number): PassInfo;
    /** The pipeline for (mesh shader + state + geometry layout, pass); null when it can't be built (already reported). */
    get(mesh: Mesh, passInfo: PassInfo): GPURenderPipeline | null;
    /** Warm-up: compile asynchronously so later draws hit the cache. */
    compileAsync(mesh: Mesh, passInfo: PassInfo): Promise<GPURenderPipeline | null>;
    key(mesh: Mesh, passInfo: PassInfo): string;
    descriptor(mesh: Mesh, passInfo: PassInfo): GPURenderPipelineDescriptor;
    describe(mesh: Mesh, passInfo: PassInfo, state?: MeshState): string;
    clear(): void;
}

// =============================================================================
// @core/PerDrawBuffer — engine uniform buffer behind group(1), in fixed slots bound
// via dynamic offsets: one permanent object slot per Mesh (rewritten only when it
// moves) and the frame's next camera slot per render(). Doubles when full.
// =============================================================================

/** Byte size of the engine camera block (group(1) binding 0). Not in the barrel — import via `@core/PerDrawBuffer`. */
export const CAMERA_SIZE: number;
/** Byte size of the engine object block (group(1) binding 1). Not in the barrel — import via `@core/PerDrawBuffer`. */
export const OBJECT_SIZE: number;
/** Byte size of the engine time block (group(3) binding 0: time, delta). Not in the barrel — import via `@core/PerDrawBuffer`. */
export const TIME_SIZE: number;
/** Bytes group(3) binds at `perDraw.timeOffset` (TIME_SIZE rounded up to 16). Not in the barrel — import via `@core/PerDrawBuffer`. */
export const TIME_BINDING_SIZE: number;

export class PerDrawBuffer {
    constructor(gpu: GPU, options?: { label?: string; size?: number });
    gpu: GPU;
    /** Replaced when the buffer grows (see `generation`). */
    buffer: GPUBuffer;
    /** minUniformBufferOffsetAlignment of the device. */
    align: number;
    /** Bytes per slot (block size rounded up to `align`). */
    stride: number;
    /** Slots the buffer holds now. */
    capacity: number;
    size: number;
    /** Bumped when `buffer` is replaced; bind groups over the old one are stale. */
    generation: number;
    /** Bumped at each frame start and renderer-owned submit. */
    epoch: number;
    /** CPU copy of `buffer`; writes land here, `flush` uploads the dirty slots. */
    mirror: Uint8Array;
    /** Float32 view over `mirror`. */
    f32: Float32Array;
    /** Dirty slots not yet uploaded. */
    readonly pending: number;
    /** Byte offset of the time slot (slot 0, never released) that group(3) binds. */
    readonly timeOffset: number;

    /** Camera block in the frame's next camera slot; returns its dynamic offset. A null camera writes identity matrices. */
    writeCamera(camera: Camera | null | undefined, width: number, height: number): number;
    /** Time block (time, delta in seconds) in the time slot; marks it dirty only when a value changed. Renderer.render calls it. */
    writeTime(time: number, delta: number): void;
    /** `mesh`'s object slot (acquired on first use, rewritten only when it moved or its shader needs more); returns its dynamic offset. */
    writeObject(mesh: Mesh): number;
    /** Give `mesh`'s slot back (Mesh.destroy calls this). */
    release(mesh: Mesh): void;
    /** Upload the dirty slots. Renderer.render calls it; a draw outside render() must too. */
    flush(): void;
    /** Frame boundary: camera slots restart, released slots become reusable, retired buffers are destroyed. Renderer.update calls it. */
    reset(): void;
    destroy(): void;
}

// =============================================================================
// @core/Mesh — geometry + Shader + plain state + bind groups. Holds no GPU
// objects; the renderer derives the pipeline and binds the engine groups 1 and 3.
// =============================================================================

/**
 * Plain, per-mesh render state. Compared by identity (Mesh freezes it): replace
 * the object, don't mutate it. All fields optional; defaults shown.
 */
export interface MeshState {
    /** default false — alpha-blend + back-to-front sort bucket. */
    transparent?: boolean;
    /** default true */
    depthWrite?: boolean;
    /** default true */
    depthTest?: boolean;
    /** Derived from depthTest when unset. */
    depthCompare?: GPUCompareFunction;
    depthBias?: number;
    depthBiasSlopeScale?: number;
    depthBiasClamp?: number;
    /** default 'back' */
    cullMode?: GPUCullMode;
    /** default 'ccw' */
    frontFace?: GPUFrontFace;
    /** default 'triangle-list' */
    topology?: GPUPrimitiveTopology;
    blending?: BlendingOptions;
    writeMask?: GPUColorWriteFlags;
}

export interface MeshOptions {
    label?: string;
    geometry: Geometry;
    shader: Shader;
    state?: MeshState;
    /** Indexed by group; indices 1 and 3 must be empty (the engine's). Missing slots bind the renderer's empty group. */
    bindGroups?: GPUBindGroup[];
    manualRender?: boolean;
    renderOrder?: number;
    frustumCulled?: boolean;
}

export interface DrawArgs {
    pass: GPURenderPassEncoder;
    passInfo: PassInfo;
    renderer: Renderer;
    camera?: Camera | null;
    /** Dynamic offset of this render()'s camera slot in the PerDrawBuffer. */
    cameraOffset: number;
    /** What the encoder already has bound; repeated pipelines, groups and buffers are skipped. */
    bound?: BoundState | null;
}

/** Pipeline, bind groups and vertex/index buffers already set on a pass or bundle encoder. Import via `@core/Mesh`. */
export class BoundState {
    pipeline: GPURenderPipeline | null;
    groups: GPUBindGroup[];
    vertex: GPUBuffer[];
    index: GPUBuffer | null;
    indexFormat: GPUIndexFormat | null;
    /** Forget everything — after anything else encoded into the pass (executeBundles clears its state). */
    reset(): this;
}

/** Set vertex/index buffers and issue the draw (indexed, indirect or plain); `bound` skips buffers already set. Import via `@core/Mesh`. */
export function drawGeometry(pass: GPURenderPassEncoder | GPURenderBundleEncoder, geometry: Geometry, bound?: BoundState | null): void;

export class Mesh extends Transform {
    /** `new Mesh(gpu, …)` (the legacy pipeline path) throws. */
    constructor(options: MeshOptions);
    label: string;
    manualRender: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    geometry: Geometry;
    shader: Shader;
    /** Frozen on assignment. */
    state: MeshState;
    /** Setting a group at index 1 or 3 throws. */
    bindGroups: GPUBindGroup[];
    /** Cached against `worldVersion`, computed only when the shader reads it — call updateDerived() before reading in JS. */
    normalMatrix: Mat3;
    objectMatrix: Mat4;
    /** Set by Renderer.getRenderQueue for sorting. */
    zDepth?: number;
    /** Reused result object populated by Raycast — copy what you need. */
    hit?: any;

    /** Frees the mesh's engine slot (a mesh holds no GPU objects). A destroyed mesh that draws again takes a new slot. */
    destroy(): void;
    onBeforeRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    onAfterRender(f: (args: { mesh: Mesh; camera: Camera | null }) => void): this;
    /** Make the `needs` matrices (default: both) current for this worldVersion. */
    updateDerived(needs?: number): void;
    draw(args: DrawArgs): void;
}

// =============================================================================
// @core/RecordedGroup — a Transform whose Mesh descendants replay from a
// GPURenderBundle recorded by record(). See src/core/CLAUDE.md for when it fits.
// =============================================================================

export class RecordedGroup extends Transform {
    constructor(options?: { label?: string });
    label: string;
    readonly isRecordedGroup: true;
    /** True once record() has run. Never recorded → the renderer skips it (warned once). */
    readonly recorded: boolean;
    /** Snapshot the visible descendant meshes now; bundles re-encode lazily per pass kind. */
    record(): this;
    /** Child set, visible, shader/version, state, geometry, bindGroups or drawBuffer/drawBufferOffset changed since record(). O(descendants). */
    readonly stale: boolean;
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
    defs: ShaderDefs;
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
     * The BindGroupLayout of one kernel's group. Both arguments are required: a
     * kernel (entry-point) name and a group index; anything else throws. Holds only
     * what that kernel uses, interned by shape (kernels reading the same bindings
     * share it; bind groups stay valid across a shape-preserving hot reload). With an
     * explicit `layout` option it wraps that pipeline's layout instead, not interned:
     * names and required bindings are every binding the module declares in the group,
     * so the caller's layout must hold all of them.
     */
    bindGroupLayout(kernel: string, group: number): BindGroupLayout;
    dispatch(encoder: GPUCommandEncoder, options: DispatchOptions): void;
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
    /** Final skin matrices (root-relative pose × bind inverse), uploaded by updateBones. */
    boneMatrixBuffer: GPUBuffer;
    /** Per-bone bind inverse: glTF inverseBindMatrices, else FK-derived from the bind pose. */
    inverseBindMatrices: Mat4[];
    /** True after an upload the skinning dispatch hasn't consumed yet. */
    poseDirty: boolean;
    skinner: ComputeShader;
    skinningBindGroup: GPUBindGroup;

    initBones(): void;
    createGeometryBuffer(name: string, size: number, data: ArrayBufferView): GPUBuffer;
    initSkinning(): void;
    addAnimation(animation: Animation): void;
    getAnimation(label: string): Animation | undefined;
    /** Blend all registered animations into the bone pose. */
    applyAnimations(): void;
    /** Upload root-relative pose × bind inverse to the bone matrix buffer; false (no upload) when unchanged. */
    updateBones(): boolean;
    /** applyAnimations() + updateBones() + skinning dispatch — only when the pose changed. With `encoder`, records only (no submit). */
    update(dt?: number, encoder?: GPUCommandEncoder | null): void;
}

// =============================================================================
// @core/Renderer — owns device, context, depth texture, RAF loop, render queue.
// =============================================================================

export interface RendererOptions {
    canvas?: HTMLCanvasElement | null;
    dpr?: number | null;
    transparent?: boolean;
    depth?: boolean;
    /** Starting byte size of the engine's PerDrawBuffer (default 1 MiB); it doubles when full. */
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

/** Per-canvas swapchain config for setContext/contextFor. Omitted fields keep
 *  the canvas's last configuration (renderer defaults on first configure). */
export interface CanvasContextOptions {
    /** Premultiplied (true) vs opaque (false) compositing for this canvas. */
    transparent?: boolean;
    /** Swapchain format — pipelines drawn into this canvas must target it. */
    format?: GPUTextureFormat;
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
    /** Layout of the engine's group(1): dynamic camera + object slots of `perDraw`. */
    engineLayout: GPUBindGroupLayout;
    /** Getter: rebuilt when `perDraw` grows (its `generation` moves); null after destroy(). */
    readonly engineBindGroup: GPUBindGroup | null;
    /** Layout of the engine's group(3): the `time` block (time, delta), plain uniform. */
    timeLayout: GPUBindGroupLayout;
    /** Getter: group(3) bind group over `perDraw`'s time slot, set once per pass; rebuilt when `perDraw` grows, null after destroy(). */
    readonly timeBindGroup: GPUBindGroup | null;
    /** Shared layout/bind group for empty slots in a Shader's pipeline layout. */
    emptyLayout: GPUBindGroupLayout;
    emptyBindGroup: GPUBindGroup;
    /** Derives and caches the GPURenderPipeline for each (shader, state, geometry, pass). */
    pipelines: PipelineCache;
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
    /**
     * Warm-up: compile every Mesh pipeline `scene` needs for `target` (or the
     * canvas) asynchronously so the first draw doesn't stall. Optional.
     */
    compile(options: { scene: Transform; target?: RenderTarget | null }): Promise<void>;
    /** `node.scissor` intersected with its ancestors' and clamped to the target; null when empty. Fills `out` if given. */
    resolveScissor(node: Transform, targetWidth: number, targetHeight: number, out?: ScissorRect): ScissorRect | null;
    render(options: RenderOptions): void;
    /** Bind another canvas for exactly the next render(); null restores now. */
    setContext(canvas?: HTMLCanvasElement | null, options?: CanvasContextOptions): void;
    /** Configured, augmented context for any canvas — its view is a pass `target`. */
    contextFor(canvas: HTMLCanvasElement, options?: CanvasContextOptions): GPU;
}

// =============================================================================
// @core/ShaderReload — hot-reload registry (dev only; not in the barrel).
// =============================================================================

/** Register a Shader/RenderPipeline/ComputeShader for WGSL hot-reload. Returns an unregister fn. */
export function registerShader(instance: Shader | RenderPipeline | ComputeShader): () => void;

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
 * Pass-style target for gui.uniform(): an object owning its own uniforms —
 * `.uniforms` (a StructView), `.gpu`, and optionally the `.uniformBuffer`
 * GPUBuffer it's written to (written immediately on change). Not a Mesh or
 * RenderPipeline. A UniformBuffer is accepted directly.
 */
export interface UniformTarget {
    uniforms: StructView;
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
    /** Bind a uniform on a UniformBuffer or pass; writes through on change. */
    uniform(target: UniformBuffer | UniformTarget, key: string, opts?: Record<string, unknown>): any;
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
    /** Override constants baked into the shared Shader (e.g. roughnessLevels). */
    constants?: Record<string, number>;
    /** Parse geometry/skin/animation only — no shader/materials/textures. */
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
    /** The one Shader shared by every primitive; null when dataOnly. */
    shader: Shader | null;
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

// --- @modules/gsplat (Gaussian splat renderer + loaders) ----------------------
export type SplatFormat = 'ply' | 'splat' | 'spz' | 'sog';

/** Loader output; every array is `count × 4` floats. */
export interface SplatData {
    count: number;
    /** `[x, y, z, 0]` world space. */
    positions: Float32Array;
    /** `[r, g, b, a]` gamma-space colour, straight (not premultiplied) opacity. */
    colors: Float32Array;
    /** `[x, y, z, w]` unit quaternion. */
    rotations: Float32Array;
    /** `[sx, sy, sz, 0]` linear world-space std devs. */
    scales: Float32Array;
    /** Higher-order SH is parsed but dropped. */
    sh: null;
}

/** `.ply`, `.splat`, `.spz` (v1–3) and `.sog` (bundled, or an unbundled `meta.json` URL). */
export function loadSplat(src: string | ArrayBuffer, options?: { type?: SplatFormat }): Promise<SplatData>;

export interface GaussianSplatOptions {
    data: SplatData;
    /** Override render WGSL; keep the bindings of `gsplat.wgsl`. */
    code?: string;
    sortMethod?: 'radix' | 'bitonic';
    sortMode?: 'gpu' | 'cpu' | 'sliced';
    /** 64 / 128 / 256; baked as an override constant. */
    workgroupSize?: number;
    label?: string;
}

export class GaussianSplat extends Mesh {
    constructor(gpu: GPU, options: GaussianSplatOptions);
    sortMethod: 'radix' | 'bitonic';
    sortMode: 'gpu' | 'cpu' | 'sliced';
    /** Radix passes per frame in `'sliced'` mode (8 per full sort). */
    slicePasses: number;
    /** EMA-smoothed sort ms: GPU timestamps, or worker wall time in `'cpu'` mode. */
    sortTime: number;
    /** Call every frame BEFORE `renderer.render`. With `encoder`, records only (no submit, no timing). */
    sort(camera: Camera, options?: { encoder?: GPUCommandEncoder | null }): void;
    /** `'sliced'` mode: call every frame instead of `sort`; `dirty` = the order went stale. */
    sortSliced(camera: Camera, dirty?: boolean, options?: { encoder?: GPUCommandEncoder | null }): void;
    /** Rebuilds the sort pipelines and their bind groups. */
    setWorkgroupSize(size: number): void;
    /** Frees GPU buffers, terminates the sort worker, unregisters the sort shaders. */
    destroy(): void;
}

// =============================================================================
// @modules/text — MSDF text (msdf-atlas-gen atlases) + SplitText-style reveals.
// =============================================================================

export interface MSDFFontLoadOptions {
    /** URL of the msdf-atlas-gen json, or the parsed object. */
    json: string | object;
    /** URL of the atlas png — decoded without premultiplied alpha. */
    image: string;
    label?: string;
}

export interface MSDFGlyph {
    advance: number;
    /** [left, bottom, right, top] in em, y up; null for blank glyphs (space). */
    plane: [number, number, number, number] | null;
    /** [u, v] at the quad's bottom-left then top-right; null for blank glyphs. */
    uv: [number, number, number, number] | null;
}

export class MSDFFont {
    /** Await `ready` before building an MSDFText on it (or use `MSDFFont.load`). */
    constructor(gpu: GPU, options: { json: object; image: ImageBitmap; label?: string });
    static load(gpu: GPU, options: MSDFFontLoadOptions): Promise<MSDFFont>;
    type: 'msdf' | 'mtsdf' | 'sdf' | 'psdf';
    pxRange: number;
    /** Atlas pixels per em. */
    emPx: number;
    /** The distance-field margin around every glyph quad, in em. */
    padEm: number;
    metrics: {
        emSize: number;
        lineHeight: number;
        ascender: number;
        descender: number;
        underlineY: number;
        underlineThickness: number;
    };
    glyphs: Map<number, MSDFGlyph>;
    texture: Texture;
    sampler: GPUSampler;
    ready: Promise<MSDFFont>;
    glyph(codepoint: number): MSDFGlyph | undefined;
    kerning(a: number, b: number): number;
    destroy(): void;
}

export interface TextLayoutOptions {
    /** World units per em. */
    size?: number;
    /** Wrap width in world units. */
    width?: number;
    /** In em; defaults to the font's. */
    lineHeight?: number;
    /** In em. */
    letterSpacing?: number;
    align?: 'left' | 'center' | 'right';
    anchorX?: 'left' | 'center' | 'right';
    anchorY?: 'top' | 'middle' | 'bottom' | 'baseline';
}

export type TextBox = [number, number, number, number];

export interface TextLayout {
    glyphs: {
        rect: TextBox;
        uv: TextBox;
        char: number;
        word: number;
        line: number;
        charBox: TextBox;
        wordBox: TextBox;
        lineBox: TextBox;
    }[];
    counts: { chars: number; words: number; lines: number };
    bounds: TextBox;
    width: number;
    height: number;
}

export function layoutText(font: MSDFFont, text: string, options?: TextLayoutOptions): TextLayout;

export type TextSplit = 'chars' | 'words' | 'lines';

export interface TextRevealFrom {
    /** em */
    x?: number;
    y?: number;
    z?: number;
    /** % of the stagger unit's own box (y up: -100 = one box below). */
    xPercent?: number;
    yPercent?: number;
    /** degrees; `rotation` is z. */
    rotation?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    opacity?: number;
    /** em, capped by the atlas pxRange. */
    blur?: number;
}

export interface TextRevealOptions {
    split?: TextSplit;
    mask?: 'none' | TextSplit;
    order?: 'start' | 'end' | 'center' | 'edges' | 'random';
    ease?: 'none' | 'linear' | 'power1.out' | 'power2.out' | 'power3.out' | 'power4.out' | 'expo.out' | 'back.out' | 'sine.out' | 'circ.out' | 'power3.inOut' | 'expo.inOut' | 'elastic.out';
    duration?: number;
    stagger?: number;
    delay?: number;
    /** Pivot inside the unit box, 0..1. */
    origin?: [number, number];
    wipe?: 'left-to-right' | 'right-to-left' | 'bottom-to-top' | 'top-to-bottom' | [number, number] | null;
    wipeSoftness?: number;
    seed?: number;
    from?: TextRevealFrom;
}

export const TEXT_PRESETS: Record<string, TextRevealOptions>;

export interface MSDFTextOptions extends TextLayoutOptions {
    font: MSDFFont;
    text?: string;
    color?: ArrayLike<number>;
    /** em */
    outline?: number;
    outlineColor?: ArrayLike<number>;
    depthTest?: boolean;
    /** Variant of the shared text shader (same bindings); pass formats come from the pass. */
    shader?: Shader;
    label?: string;
    renderOrder?: number;
}

export class MSDFText extends Mesh {
    constructor(gpu: GPU, options: MSDFTextOptions);
    gpu: GPU;
    /** Per-text reveal + look uniforms (uColor, uOutline, …), bound at group(0). */
    uniforms: UniformBuffer;
    font: MSDFFont;
    text: string;
    layout: TextLayout;
    layoutOptions: TextLayoutOptions;
    glyphCount: number;
    counts: { chars: number; words: number; lines: number };
    /** Advance play()/reverse() from renderer.time at each draw. */
    autoUpdate: boolean;
    /** Seconds on the reveal timeline; negative while inside the delay. */
    time: number;
    totalDuration: number;
    delay: number;
    progress: number;
    readonly playing: boolean;
    set color(c: ArrayLike<number>);
    setText(text: string, options?: TextLayoutOptions): this;
    animate(preset: string | TextRevealOptions, overrides?: TextRevealOptions): this;
    seek(time: number): this;
    play(): Promise<void>;
    reverse(): Promise<void>;
    update(dt: number): this;
    destroy(): void;
}

// =============================================================================
// Utils (@utils/*)
// =============================================================================

// --- @utils/BufferUtils --------------------------------------------------------
export interface CreateBufferOptions {
    label?: string;
    /** Bytes. Defaults to `data.byteLength` rounded up to 4 when `data` is given; otherwise required. */
    size?: number;
    usage?: GPUBufferUsageFlags;
    /** Initial contents, copied in at creation (mappedAtCreation). An explicit `size` must be >= its byteLength and a multiple of 4. */
    data?: ArrayBuffer | ArrayBufferView;
}
/** Raw buffer with GPUBufferUsage.STORAGE OR'd in (default usage COPY_DST | COPY_SRC). */
export function createStorageBuffer(gpu: GPU, options: CreateBufferOptions): GPUBuffer;
/**
 * @deprecated Use `UniformBuffer` for a uniform struct, or
 * `createBuffer(gpu, { usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, data })`
 * for raw data. Warns once, then forwards to createBuffer with UNIFORM usage.
 */
export function createUniformBuffer(gpu: GPU, options: { label?: string; size: number; usage?: GPUBufferUsageFlags }): GPUBuffer;
/** Raw buffer (default usage COPY_DST | COPY_SRC); structless uniform data passes UNIFORM | COPY_DST. */
export function createBuffer(gpu: GPU, options: CreateBufferOptions): GPUBuffer;

// --- @utils/RenderUtils ----------------------------------------------------------
/**
 * Record a fullscreen color-only pass drawing `geometry` (gpu.TRIANGLE, or
 * gpu.QUAD) through `pipeline` into `targetView`. Pass the RenderPipeline
 * WRAPPER, not the raw .pipeline. `bindGroup` binds at group(0) with no
 * dynamic offsets.
 */
export function blit(
    encoder: GPUCommandEncoder,
    options: {
        pipeline: RenderPipeline;
        geometry: Geometry;
        targetView: GPUTextureView;
        /** Depth attachment, for pipelines whose fragment writes frag_depth. */
        depthView?: GPUTextureView;
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
declare module '@core/RecordedGroup' {
    export { RecordedGroup };
}
declare module '@core/Mesh' {
    export { Mesh, MeshOptions, MeshState, DrawArgs, BoundState, drawGeometry };
}
declare module '@core/Shader' {
    export { Shader, ShaderOptions, ShaderResource, ENGINE_GROUP, NEEDS_NORMAL, NEEDS_OBJECT };
}
declare module '@core/UniformBuffer' {
    export { UniformBuffer };
}
declare module '@core/BindGroupLayout' {
    export { BindGroupLayout };
}
declare module '@core/PipelineCache' {
    export { PipelineCache, PassInfo };
}
declare module '@core/reflect' {
    export { StructView, makeStructuredView, reflect, ShaderDefs };
}
declare module '@core/RenderPipeline' {
    export { RenderPipeline, RenderPipelineOptions, BlendingOptions };
}
declare module '@core/PerDrawBuffer' {
    export { PerDrawBuffer, CAMERA_SIZE, OBJECT_SIZE };
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
    export { Vec2, Vec3, Vec4, Quat, Mat3, Mat4, Euler, Color, vec2, vec3, vec4, quat, mat3, mat4 };
}
declare module '@math/functions' {
    export { vec2, vec3, vec4, quat, mat3, mat4 };
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
declare module '@modules/gsplat/GaussianSplat' {
    export { GaussianSplat, GaussianSplatOptions };
}
declare module '@modules/gsplat/SplatLoader' {
    export { loadSplat, SplatData, SplatFormat };
}
declare module '@modules/text' {
    export { MSDFFont, MSDFText, TEXT_PRESETS, layoutText };
}
declare module '@modules/text/MSDFFont' {
    export { MSDFFont, MSDFFontLoadOptions, MSDFGlyph };
}
declare module '@modules/text/MSDFText' {
    export { MSDFText, MSDFTextOptions };
}
declare module '@modules/text/layout' {
    export { layoutText, TextLayout, TextLayoutOptions, TextBox };
}
declare module '@modules/text/presets' {
    export { TEXT_PRESETS, TextRevealOptions, TextRevealFrom, TextSplit };
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
