# src/core — engine primitives; signatures live in repo-root api-digest.md

## The `gpu` object

Never pass `device` directly. `Renderer.init` augments the canvas context with
`.device`, `.presentationFormat`, and `.renderer` — that augmented context object
(`renderer.gpu`) is what every class here receives and stores. Passing the raw
`GPUDevice` breaks `presentationFormat` lookups and the renderer back-reference.

## Initialization order

`new Renderer()` fires `initDevice()` immediately but the device, KTX wasm, and
canvas context are set up asynchronously. Nothing GPU-touching is safe until
`await renderer.ready`. The `update` loop starts inside `init()` (before `ready`
resolves) but bails early on `!this.isReady`, so callbacks added before `ready`
won't run.

`initDevice()` is also the recovery entry point and runs more than once: the
first call does one-time setup via `init()` (canvas, resize/visibility handlers,
KTX load — all guarded so they don't repeat); every later call re-acquires a
device and runs `_restore()` instead. KTX is loaded once (`if (!window.ktx)`);
`TimingHelper` is device-bound and remade each time.

## Device-loss recovery

`device.lost` is wired to `_onDeviceLost`, which sets `isReady = false` (this is
what stops the RAF loop — `update()` relinquishes ownership and returns the
moment `isReady` is false, see `_loopRunning`/`_startLoop`), fires
`deviceLostHandlers`, then calls `initDevice()` again unless `reason ===
'destroyed'` (a deliberate teardown we don't fight). The single-owner loop guard
means a recovery that races the dying loop can't spawn a second one.

The engine only restores **engine-owned** state on recovery (context
reconfigure, depth texture, the per-draw uniform buffer). Everything app code
built — pipelines, buffers, textures, bind groups, `Mesh`/`Geometry`/
`ComputeShader` instances — was tied to the dead device and is gone. Owners must
rebuild them in a `renderer.addDeviceRestoredHandler(gpu => {...})` callback
(returns an unsubscribe fn); the callback receives the fresh `gpu`. Without it
the loop recovers and the canvas paints, but the scene is empty. There's no
automatic scene rebuild — that boundary is deliberate. Recreate `Mesh`
INSTANCES here, don't just rebuild their bind groups: a surviving mesh's
`uniformResource` still points at the dead device's per-draw buffer, so the
bind-group-only rebuild pattern (valid for same-device texture resizes) binds
cross-device after a loss.

Test it without a real GPU loss via `renderer.forceDeviceLoss()`: WebGPU exposes
no way to synthetically lose a device (`destroy()` reports `'destroyed'`, which
recovery skips), so this drives `_onDeviceLost` with a non-destroyed reason to
exercise re-acquire + restore. Expect a `[webgpu] device restored` log and a
still-running loop.

## Teardown & error surfaces

`renderer.destroy()` is the SPA teardown: stops the RAF loop, disconnects the
resize observer and `visibilitychange` listener, destroys the per-draw buffer
and depth textures (including parked extra-canvas ones), unconfigures every
context it touched, and destroys the device (reason `'destroyed'`, which
recovery deliberately skips). The renderer is dead afterwards — make a new one.
App-owned GPU resources remain the app's to destroy, same boundary as
device-loss recovery.

`renderer.addErrorHandler(cb)` surfaces `uncapturederror` as `(error, event)`;
`event.preventDefault()` silences the browser's own console report. Constructor
preconditions (missing gpu/code/pipeline/geometry) THROW — no more
console.error-and-return half-built objects — and shader build failures rethrow
with the pipeline/shader label attached.

## Multiple canvases — `setContext`

`renderer.setContext(canvas)` points the **next** `render()` at another canvas;
`render()` hands the default canvas back on its way out, so a binding lasts
exactly one render — that's the `try/finally` wrapping `render`'s body, which
covers its early returns (no device / not ready / paused) too.
`setContext(null)` restores immediately.

`getContext('webgpu')` returns the same object for a given canvas, so the
context doubles as the per-canvas record: it's configured on first bind, carries
its own depth texture (`context.depthTexture`), and `setContext` swaps
`this.gpu` / `this.depthTexture` in and out of it. Consequences:

- Extra canvases are **not** observed — set `canvas.width/height` yourself.
  `this.width`/`this.height` and the resize handlers track the default canvas
  only; the depth texture is sized against `this.gpu.canvas` and remade on
  mismatch. Cameras are per-canvas too (aspect).
- Only `Renderer.render` follows the binding — `target: null` there means the
  **bound** canvas. Nothing else does: a `blit` draws into the `targetView` it
  was handed, and anything holding a `gpu` reference keeps drawing into the
  canvas it was built with.
- `renderer.contextFor(canvas)` is the same lazy configure **without** binding —
  use it when only the final blit needs to move: hand `blit` a
  `contextFor(c).getCurrentTexture().createView()` as its `targetView` (per
  frame — a swapchain texture doesn't survive one; the context object does).
  The pass pipeline's `targets[0].format` must be the canvas format — every
  canvas defaults to the shared `presentationFormat`.
- Both `setContext(canvas, options)` and `contextFor(canvas, options)` take
  per-canvas `{transparent, format}` — an opaque main canvas + a transparent
  overlay no longer needs two renderers. Omitted options stick to whatever the
  canvas was last configured with (device-loss reconfigure preserves them);
  first configure falls back to the renderer defaults. A custom `format`
  means pipelines drawn into that canvas must be built with
  `targets: [{format}]` (or with that canvas's context as their `gpu`) — the
  engine default targets `presentationFormat` and will fail attachment
  validation against a differently-formatted canvas.
- Meshes/pipelines are shared, no per-canvas uniform buffers needed — each draw
  takes its own `PerDrawBuffer` slice (see below), so one scene can be drawn
  into N canvases within a frame.
- After a device loss an extra context still holds the dead device, so it's
  reconfigured (and its depth texture remade) on the next bind.

## Transform — quaternion/rotation two-way proxy

`this.rotation` and `this.quaternion` are kept in sync via `onChange` hooks wired
in the constructor. **Never replace the quaternion with a new instance**
(`node.quaternion = new Quat(...)`). That orphans the hook — `rotation` stops
updating and anything downstream that reads it breaks silently. Mutate in place:
`node.quaternion.set(...)` or `node.quaternion.copy(other)`.

`decompose()` writes `matrix` back to position/quaternion/scale via the raw
wgpu-matrix decompose, which bypasses the `Quat` setter. It manually fires
`quaternion.onChange()` afterwards — if you decompose by any other means, do
the same or `rotation` will drift.

## Camera — frustum extraction

`updateFrustum()` uses Gribb-Hartmann plane extraction adjusted for WebGPU's
`[0, 1]` clip-z (not GL's `[-1, 1]`). The near plane is row 3 of the projection-
view matrix alone — not `row3 + row2`. Porting frustum culling from GL without
this adjustment passes near-clipped geometry through.

`Camera.lookAt` inverts the eye/target convention vs `Transform.lookAt` — the
camera version passes `invert=true` so `+Z` aims AT the target (camera faces
forward). `Transform.lookAt` without invert aims `+Z` away from target.

## Mesh — uniform name matching

`Mesh.draw` writes standard per-frame uniforms by **name** via webgpu-utils
reflection, not by location. Any shader bound through a Mesh must declare a
`Uniforms` struct containing the subset it uses with exact names
(`projectionMatrix`, `viewMatrix`, `modelMatrix`, `modelViewMatrix`, `objectMatrix`,
`normalMatrix`, `cameraPosition`, `cameraQuaternion`, `resolution`, `time`).
A misnamed field is silently skipped — no validation error, just a stale value
(likely typos of standard names warn once at Mesh construction; `u`-prefixed
custom names like `uTime` are exempt). A shader with no `uniforms` var at all
is fine: the mesh gets an inert stub and group 0 binds without a dynamic offset.

`normalMatrix` is a Mat3 adjugate of `worldMatrix` (not the inverse-transpose
of modelView) — correct for non-uniform scale, but only valid in world space.

## Geometry — vertex/instance buffers are VERTEX-only by default

webgpu-utils creates every attribute buffer with `usage | GPUBufferUsage.VERTEX`
where the extra usage defaults to 0 and data is uploaded via `mappedAtCreation`.
So `queue.writeBuffer` on a vertex/instance buffer **fails validation silently**
(uncaptured error, draw keeps using creation contents) unless you construct the
`Geometry` with `usage: GPUBufferUsage.COPY_DST`. Anything that live-updates
vertex or instance attributes needs this. The primitive classes (`Sphere`,
`Box`, …) don't forward `usage` — use a plain `Geometry` with
`primitives.create*Vertices` when you need it.

## Frustum culling exclusions

`Camera.frustumIntersectsMesh` skips auto-cull (returns `true`) for any
instanced geometry or geometry with no `position` attribute — since there's no
CPU-accessible extent. **Instanced** here means `geometry.instanced`, a getter
that's true when the geometry has per-instance attributes _or_ a `drawBuffer`
(indirect draws supply the instance count on the GPU). These meshes are NEVER
culled unless you set explicit `geometry.bounds`. Skinned glTF meshes do
this (`frustumCulled = false` on skinned nodes). `Geometry.computeBoundingSphere`
computes from `this.attributes.position`; for storage-buffer-positioned meshes
you must pass `{data, stride}` explicitly.

## RenderPipeline / Mesh — who owns uniforms and bind groups

`RenderPipeline` is **pure compiled state** — `.pipeline`, `.defs`, `.vertexBuffers`
(the vertex layout it was built from), `.module`. It owns NO uniform buffer and NO bind groups, so one pipeline can be
shared across many meshes. (It used to carry `uniforms`/`uniformBuffer`/
`createBindGroup`/`updateBindgroup` — all removed.) It serves bind group layouts
to callers via `pipeline.bindGroupLayout(i)` (mirrors `ComputeShader.bindGroupLayout`)
— don't reach into `pipeline.pipeline.getBindGroupLayout(i)`; the getter returns
the explicit, hot-reload-stable BGL it built.

Each **`Mesh`** owns a structured uniform view (`mesh.uniforms`, built from the
pipeline's reflected `uniforms` struct) and a slice descriptor (`mesh.uniformResource`
= `{buffer, offset: 0, size: mesh.structSize}`) into the renderer-owned
`PerDrawBuffer` (`gpu.renderer.perDraw`) — the mesh does NOT own a uniform buffer.
The constructor REQUIRES `bindGroups`: either a `GPUBindGroup[]` or a factory
`(uniformResource) => GPUBindGroup[]` — the factory receives that slice descriptor
so group(0) binds it verbatim at binding 0. Build groups against
`pipeline.bindGroupLayout(i)`, one per group index. Set custom uniforms via
`mesh.uniforms.set({...})` (NOT `pipeline.uniforms`).

Every `draw()` allocates a fresh slice from `perDraw` (`perDraw.alloc(byteLength)`),
writes this mesh's uniforms there, and binds group(0) with a dynamic offset
(`pass.setBindGroup(0, bindGroup, [offset])`) — `RenderPipeline.build` marks the
group(0)/binding(0) buffer entry `hasDynamicOffset: true` for this reason. The
buffer's `pointer` resets once per rendered frame (`Renderer.update`, after the
paused early-return) and accumulates across every `render()` call within that
frame — that's what lets one mesh draw into multiple chained passes safely.
Overflowing the buffer (`perDrawSize`, default 1 MiB, set via the `Renderer`
constructor) logs a console error instead of growing it — growing would
invalidate every already-bound group(0). Device recovery recreates `perDraw`
alongside the depth texture in `_restore`; app-owned bind groups still rebuild
in `deviceRestoredHandler`s as before.

**Texture resize:** destroying/recreating a `Texture` invalidates its
`GPUTextureView`s, so any bind group holding them is stale. Rebuild the affected
group: `mesh.bindGroups[i] = device.createBindGroup({ layout:
pipeline.bindGroupLayout(i), entries: [...fresh...] })` (use
`mesh.uniformResource` for binding 0). For a per-frame ping-pong, prebuild the
variants and swap the slot: `mesh.bindGroups[0] = variants[t % 2]`.

**Non-Mesh draw issuers** (fullscreen / blit passes that draw without a `Mesh`)
own their uniform buffer the same way: `makeStructuredView(pipeline.defs.
uniforms.uniforms)` + `createUniformBuffer`, written with `device.queue.writeBuffer`, bound
via `device.createBindGroup` against the pipeline layout. One consequence of the
per-draw model: `RenderPipeline.build` marks group(0)/binding(0) `hasDynamicOffset`
on EVERY pipeline, so a direct draw must pass a zero offset —
`pass.setBindGroup(0, bindGroup, [0])` — or the pass fails validation with a
dynamic-offset count mismatch. Fullscreen passes can skip hand-rolling that
call via the shared `blit(encoder, { pipeline, targetView, bindGroup, clear })`
helper (`@utils/RenderUtils`), which records the color-only pass and applies
the `[0]` offset internally (see the `rendertotexture` example).

**Repeat draws across passes are fine.** Each draw allocates its own slice of the
renderer-owned `PerDrawBuffer` (dynamic offsets), so a mesh can draw into a
shadow pass and a main pass — or repeat within any chained-`encoder` submit —
without the second draw's uniforms clobbering the first.

**Hot-reload:** the pipeline only rebuilds module/defs/layouts/`pipeline`. Each
`Mesh` detects the reload by comparing its cached `_defs` against `pipeline.defs`
on the next `draw`, then rebuilds its structured view — preserving values when the
struct byte length is unchanged, else updating `uniformResource.size` to the new
byte length and warning that bind groups must be recreated (no buffer to
recreate — it's a slice of the shared `PerDrawBuffer`).

`gui.uniform(target, key)` takes any object exposing `.uniforms` + `.gpu` (a
`Mesh`, or any pass owning its own uniform buffer) — pass the mesh/pass, not the
pipeline. `.uniformBuffer` is optional: passes that own a private buffer get it
written immediately; a `Mesh` has none, so the value lands in `.uniforms` and
uploads at its next `draw`.

Entry points are hardcoded: vertex = `vs`, fragment = `fs`. The vertex stage
is always emitted; the **fragment stage is emitted only if `defs.entryPoints.fs`
exists**, so a vertex-only WGSL module (shadow/depth-only passes) produces a
color-target-free pipeline automatically — don't add an empty `fs` to "satisfy"
the builder.

`depthStencil` resolves three ways, _not_ a boolean:

- `false` → omit depth state entirely (fullscreen/blit/VFX, no depth attachment).
- `{}` (the default) → engine default state (`depth24plus`, write/compare derived
  from `depthWrite`/`depthTest`).
- a populated object → used verbatim (e.g. shadow-map passes needing `depthBias`
  or `format: 'depth32float'`).

Footgun: `{}` is truthy, so a naive `this.depthStencil || default` never falls
through to the default — resolution keys on `Object.keys(...).length`, and the
descriptor must wrap the result under a `depthStencil:` key (spreading the bare
object lands its keys at the top level where WebGPU silently ignores them).

## ComputeShader — kernel cache invalidation

`this.kernels` object reference is stable across hot-reloads but its pipeline
values get swapped. Don't cache `kernels[name]` — re-read it at dispatch time.

`ComputeShader` is **pure compiled state** like `RenderPipeline` — it owns the
kernels + layouts, never bind groups. The caller builds its own bind group with
`device.createBindGroup` and passes it to `dispatch({ bindGroup })`. (It used to
own `createBindGroup`/`updateBindgroup`/`bindGroups` — all removed.) Get the
layout via `computeShader.bindGroupLayout(kernelOrKey, groupIndex)` — accepts the
kernel object (uses its `.label`) or the entry-point name string.

That layout **survives hot-reloads**: for `layout: 'auto'` the shader mints an
explicit pipeline layout per entry point _once_ (`_resolveLayout`, via webgpu-utils
`makeBindGroupLayoutDescriptors`) and reuses the same layout objects on every
rebuild. So a bind group the caller built at init against `bindGroupLayout(...)`
stays compatible with the reloaded pipeline — no recreation needed. The one thing
this can't absorb is a change to a shader's binding _shape_ (add/remove/retype a
binding): the persisted layout is keyed by entry-point name and won't track it —
that needs a hard reload, and the caller must rebuild its bind group.

`dispatch` creates and ends its own compute pass unless you pass an external
`pass`. Pass `timing: true` to add timestamp writes — the query set allocates
unconditionally but the queries only land if `timestamp-query` is in
`device.features` (it's feature-detected in Renderer, not guaranteed).

## Texture — async vs sync construction

Passing `src` (URL string or ImageBitmap) takes the async path: `this.texture`
is `null` until `this.ready` resolves. Passing `width`/`height`/`data` is
synchronous. Using a `src`-constructed texture in a bind group before `await
texture.ready` will bind `null` and explode with a GPU validation error.

Default `usage` is `TEXTURE_BINDING | COPY_DST` — not `RENDER_ATTACHMENT`.
Any texture you intend to use as a render target must be constructed with the
right usage flags; `update()` recreates the texture if usage changes.

## RenderTarget — depth texture quirk

`depthTexture` is a raw `GPUTexture` (not a `Texture` wrapper) created by
`createDepthTexture`, which destroys the old one on recreate — resize is
leak-free.
Passing `target` to `Renderer.render` without a `depthTexture` on it means no
depth testing at all. (Fullscreen `blit` passes don't go through
`Renderer.render` — they record a color-only pass with `depthStencil: false`
and no depth attachment; see `@utils/RenderUtils`.)

## Skin — world-space bones and split update

`updateBones()` computes root-relative bone matrices and uploads to the GPU. It
expects world matrices to be current — either call `root.updateMatrixWorld(true)`
yourself first, or call `update()` which does the full sequence. `updateBones()`
can be called alone (no dispatch) to drive a bake loop without running the
skinning compute every frame.

The skinning compute (skin.wgsl) multiplies bone matrices by the inverse bind pose
stored in `invBoneMatrixBuffer`. For glTF rigs this comes from `inverseBindMatrices`
in the file; for hand-built rigs it's FK-derived from the bind pose. These are NOT
interchangeable — don't mix sources.

Skeleton ancestor nodes (`skeletonAncestors`) are rebuilt as live `Transform`s so
root-motion baked onto an armature ancestor (common in Mixamo) animates correctly.
Flat rigs without ancestors skip this block entirely.
