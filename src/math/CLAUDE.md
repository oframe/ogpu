# src/math — function layer (wgpu-matrix) + chainable classes

Class signatures live in repo-root `api-digest.md`; the function layer's in
`node_modules/wgpu-matrix/dist/3.x/*-impl.d.ts` (and `types/ogpu.d.ts`). Alias:
`@math`. The function layer is `wgpu-matrix` (pinned 3.4.2) plus a few local
overrides; the classes are in-house.

## Two layers

- **`functions/`** — plain functions in namespaces `vec2`, `vec3`, `vec4`,
  `quat`, `mat3`, `mat4` (`import { mat4, vec3 } from '@math/functions'`; also
  re-exported from `@math` and `ogpu`). The **out param is last and optional**:
  omitted, a `Float32Array` of the right size is allocated; always returned.
  Each namespace re-exports the names the engine uses from wgpu-matrix's
  namespace of the same name, except the **local overrides**: `quat.rotationTo`
  (the antiparallel fix below) and `mat4.inverse`, `mat4.lookAt`, `mat4.aim`
  (measured faster: inverse ~18%, aim ~25%, lookAt ~5% on V8; same
  Float32Array results).
- **Classes** (`Vec2`–`Vec4`, `Quat`, `Mat3`, `Mat4`, `Euler`) — thin chainable
  wrappers that call the function layer with `this` as `out`. `Color` stands
  alone.

**Never import `wgpu-matrix` outside `src/math/functions/`** — the overrides (the
rotationTo fix above all) only apply through `@math/functions`; ESLint's
`no-restricted-imports` fails the lint. Adding a function: re-export it from
the wgpu-matrix namespace; write it locally only to fix a bug or after
measuring the wgpu-matrix one slower, keeping the out-last, alias-safe,
allocation-free contracts below.

## Function-layer contracts

- **Aliasing works**: `multiply(a, b, a)`, `inverse(m, m)` etc. Read inputs into
  locals before writing `out`; elementwise ops are naturally safe.
- **Hot paths allocate nothing** (multiply, inverse, fromQuat, transformQuat,
  copy, getTranslation). Module-level scratch is fine.
- **Fixed-size ops are written out, not looped or `fill`/`set`** (wgpu-matrix
  does this; a local override must too: a loop over n measured 1.1–1.7× slower
  monomorphic, 2–5× with mixed input types, `fill`/`set` 1.3–3×). They read
  and write exactly N lanes whatever the arrays' lengths, so a plain-array
  `out` works and a Vec4 passed to a vec3 op gets no 4th lane.
- **Singular / degenerate input is not guarded**: `inverse` of a singular matrix
  gives Inf/NaN; `vecN.normalize` keeps a zero vector zero; `quat.normalize`
  returns identity below length 1e-5; `vec3.transformMat4` treats w = 0 as 1.
- **`quat.rotationTo` antiparallel input** (dot < -0.999999) returns a 180°
  turn `(axis, 0)` about an axis ⊥ `a` (x̂ × a, or ŷ × a when a ≈ ±x̂); the
  arc is not unique there, so the axis is arbitrary but stable (wgpu-matrix
  3.4.2 returns a degenerate zero-axis quat here — hence the override).
  `Quat.setFromUnitVectors` inherits this.
- **`quat.fromEuler` orders are lowercase** (`'yxz'`); `'abc'` means
  qa ⊗ qb ⊗ qc. Anything else throws. `Euler` orders are uppercase (`'YXZ'`);
  its callers lowercase before `quat.fromEuler`.
- **No `mat4.create`, `mat4.invert` or `vec3.sub`** (dgpu re-exports them; ogpu
  never called them): use `new Float32Array(16)`, `mat4.inverse`, `vec3.subtract`.

## Float32Array subclassing

Every class is a `Float32Array` subclass, so any instance passes directly as an
`out` (or input) to the function layer, and uploads zero-copy — hand it to
`device.queue.writeBuffer`. Don't `new Float32Array(vec3)` (copies) or spread
into a plain array before a call (loses the out identity).

**`slice()`/`map()`/`filter()`/`subarray()` do not give you a shorter array.**
TypedArray species-constructs the result, and every constructor here takes no
length and fixes its own (`Mat4` is always 16 and identity, `Vec3` always 3).
`mat.slice(0, 3)` comes back 16 long; `mat.subarray(12, 15)` is a fresh identity
`Mat4`, not a view. Feed either to a `UniformBuffer`/struct-view `set()` for a
`vec3f` field and it throws `RangeError: offset is out of bounds` (or silently
reads the wrong values). Read by index (`[m[0], m[1], m[2]]`), use
`Mat4.getAxis(axis, out)`, or build a view by hand:
`new Float32Array(m.buffer, m.byteOffset + 48, 3)`.

## Mutating methods return `this`

All chainable methods mutate in place and return `this`. `clone()` is the only
escape hatch that returns a fresh instance. If you need a temporary, allocate
once and `copy()` into it; don't create throwaway instances per frame.

## Quat / Euler onChange contract

`Quat` and `Euler` each carry an `onChange` hook (default noop). `Transform`
wires these to keep `rotation` (Euler) and `quaternion` in sync — see
`../core/Transform.js`.

**The footgun:** if you reassign `node.quaternion = new Quat(...)` the hook is
orphaned on the old instance and the new one has the default noop. Transform's
rotation sync silently breaks. Always mutate in place: `node.quaternion.copy(q)`
or `node.quaternion.set(x, y, z, w)`.

**The loop-prevention rule:** cross-sync setters deliberately stay silent:

- `Quat.setFromEuler` does **not** fire `onChange` (Euler → Quat direction)
- `Euler.setFromQuaternion` detaches `onChange` while it runs (Quat → Euler
  direction)

If you add a new mutating method to either class, fire `this.onChange()`. If
you're building a cross-sync bridge like Transform does, you must replicate this
asymmetry or you'll loop.

## Mat3 is 12 floats, not 9

`mat3` is padded to `12 × f32` (column-major, 4 floats per column — WGSL
`mat3x3f` layout); element (row r, col c) is at `[c * 4 + r]`, the same offsets
as a mat4's upper 3×3. `new Mat3()` allocates 12. A 9-element array fed to
`Mat3`/`mat3` functions is read with the wrong stride. `mat3.set`/`fromMat4`
zero the padding; `copy` (a 16-float source gives its upper 3×3) and
`identity` leave it as it was (wgpu-matrix; 0.12.0's zeroed/copied it). WGSL
ignores it — but a plain-array `out` comes back 11 long from them.

The padding is also what makes the instance upload-ready: `mesh.normalMatrix` (a `Mat3`)
is copied verbatim into the engine's `object.normalMatrix : mat3x3f` slot, whose WGSL
layout is the same 3 × vec4 columns.

## Mat4.lookAt vs Mat4.aim

`lookAt` builds a **view matrix** (camera space, −Z forward). `aim` builds an
**object-orientation matrix** (+Z toward target). Mixing them rotates your node
180° without an error. An `up` parallel to the view direction degenerates to
zero x/y axes (no fallback).

## Projection depth is WebGPU's [0, 1]

`perspective`/`ortho` map near → 0, far → 1. `perspective` with
`far = Infinity` gives the infinite-far limit (`[10] = -1`, `[14] = -near`).

## Mat4.getMaxScaleOnAxis

Reads column lengths from the upper-left 3×3. Used by `../core/Camera.js` for
bounding-sphere frustum culling. If you apply a non-uniform scale via
`worldMatrix` the returned radius may be overly conservative — that's intentional.

## Color is linear RGB, hex inputs are NOT gamma-corrected

`new Color('#ff8800')` divides raw sRGB bytes by 255 and stores them as-is.
No gamma → linear conversion. If your asset pipeline hands you sRGB values,
convert before constructing. `Color` has no alpha channel.

## @utils dependencies

`Mat3` imports `adjugate` from `@utils/Mat3Utils`, `Mat4` imports
`compose`/`decompose` from `@utils/Mat4Utils`, `Euler` imports
`fromRotationMatrix` from `@utils/EulerUtils`. These helpers are not
on the instances themselves — call them directly if you need them outside
the class methods. The utils import `@math/functions`, never the `@math`
barrel (that would cycle through the classes).
