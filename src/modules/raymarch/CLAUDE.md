# src/modules/raymarch — SDF raymarcher as scene content

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

## Why a Mesh, not a post effect

`Raymarcher extends Mesh` and draws a fullscreen triangle in the **opaque
bucket** (`renderOrder: 100`, after the raster meshes). The fragment shader
writes `@builtin(frag_depth)` = projected hit depth and `discard`s on miss, so
depth-compositing against raster geometry is exact in both directions with no
extra pass. Consequences:

- **Writing frag_depth disables early-z.** Every covered pixel runs the march;
  the late depth test only rejects the *write*. Drawing after the opaque scene
  is still right (miss pixels keep raster output), but the known perf upgrade
  is swapping the fullscreen triangle for a box proxy over the SDF bounds —
  that restores early-z outside the volume and shrinks the marched area.
- `frustumCulled: false` is mandatory — the triangle's clip-space verts are
  garbage to the world-space culler.

## Ray + depth consistency (TAA)

Rays reconstruct from the **inverse of the live matrices** (`onBeforeRender`
inverts `camera.projectionMatrix`, uses `camera.worldMatrix` as the inverse
view). During `PostProcessing.render` the projection carries the Halton jitter,
so rays, hit depth (`proj * view * hit`, z/w) and the raster depth buffer all
agree — this is what keeps TAA from swimming on morphs. Don't cache the
inverse across frames and don't derive rays from fov/aspect on the JS side.

Screen y-down trap applies: frag coord y is down, ndc y is up —
`ndc.y = (1 - uv.y) * 2 - 1` in the shader.

Ortho cameras are unsupported (rays fan out from `cameraPosition`).

## Two pipeline variants, one WGSL

`raymarch.wgsl` is written for the post composer's MRT contract (color loc0 +
world normal loc1). For the plain-swapchain path (no `post` option) a single
color target can't accept the normal output, so `Raymarcher.js` strips the
lines tagged `//! mrt` before compile and bakes `tonemap: 1` (no FinalPass will
run). **Hot-reload feeds raw file content and won't re-apply the strip** — the
swapchain variant silently stops matching on edit; the post path (primary)
hot-reloads normally.

## Overrides and quality

`maxSteps`/`roughnessLevels`/`tonemap` are override constants baked via
`applyOverrideConstants`. `setMaxSteps`/`setQuality` mutate the same constants
object the pipeline stashed and call `pipeline.build(code)` — a full pipeline
rebuild, not a uniform write; don't drive it per-frame. Bind groups survive
(layouts are group-equivalent), `Mesh.draw` absorbs the defs swap.

Tiers: steps 40/64/96/128 (low→ultra), primitive cap 8/16 on low/medium,
reflection bounce forced off on low (`bounce` stays the user's intent; the
tier gate ANDs with it).

## SDF semantics

- Primitives are a storage buffer of `{ invTransform, params, kind, blendK,
  materialId, scale }`. `map()` is a left fold: each primitive's `blendK`
  smooth-mins it against the *accumulated* field — order matters for blends.
- Non-uniform scale: distances rescale by the **min** axis scale —
  conservative (understep, never overshoot), so marching stays correct but
  gets slower the more anisotropic the transform.
- Material id is resolved once at the hit from the closest raw primitive —
  color pops at the exact blend midpoint (v1 cut; smooth material blending is
  the extension).
- `plane` is infinite: rays that graze it burn the full step budget; presets
  keep it as the ground only.

All texture reads are `textureSampleLevel` (explicit lod) so sampling is legal
in the non-uniform control flow after the hit test — don't introduce
`textureSample`/derivatives past the march.

## IBL

Consumes the `loadIBLCubeMap` result as-is (`ibl.view`, `ibl.mipLevels` →
`roughnessLevels`, same contract as pbr.wgsl). Without `ibl` a black 1×1 cube
is bound — the key light still shades, env/reflections go dark, `envIntensity`
does nothing.
