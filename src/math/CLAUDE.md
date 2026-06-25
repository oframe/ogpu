# src/math — chainable wgpu-matrix wrappers

Signatures live in repo-root `api-digest.md`. Alias: `@math`.

## Float32Array subclassing

Every class (`Vec2`–`Vec4`, `Quat`, `Mat3`, `Mat4`, `Euler`, `Color`) is a
`Float32Array` subclass. That means any instance passes directly as the `out`
arg to `wgpu-matrix` functions, which **mutate the last param and return it**.
Zero-copy GPU uploads too — just hand the instance to `device.queue.writeBuffer`.

Don't `new Float32Array(vec3)` — that copies. Don't spread into a plain array
before passing to wgpu-matrix — that loses the out-arg identity.

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

wgpu-matrix pads `mat3` to `12 × f32` (column-major, 4 floats per column).
`new Mat3()` allocates 12, not 9. Passing a 9-element typed array to `Mat3`
methods will silently write garbage into the padding slots.

## Mat4.lookAt vs Mat4.aim

`lookAt` builds a **view matrix** (camera space, −Z forward). `aim` builds an
**object-orientation matrix** (+Z toward target). Mixing them rotates your node
180° without an error.

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
the class methods.
