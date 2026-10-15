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
reconfigure, depth texture, and `_createEngineResources`: the PerDrawBuffer,
the engine/empty layouts + bind groups, and a cleared pipeline cache).
Everything app code built — Shaders, UniformBuffers, buffers, textures, bind
groups, `Geometry`/`ComputeShader`/`RenderPipeline` instances — was tied to the
dead device and is gone. Owners must rebuild them in a
`renderer.addDeviceRestoredHandler(gpu => {...})` callback (returns an
unsubscribe fn); the callback receives the fresh `gpu`. Without it the loop
recovers and the canvas paints, but the scene is empty (each dead shader's
pipeline is reported once by the cache). There's no automatic scene rebuild —
that boundary is deliberate. A Mesh holds no GPU objects, so it can survive:
assign it a fresh `shader`, `geometry` and `bindGroups`.

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
preconditions (missing gpu/code/shader/geometry) THROW, and shader build failures rethrow
with the shader label attached. A Mesh pipeline that can't be built (bad state enum, a
vertex input the geometry lacks, async validation failure) is reported once by the
PipelineCache, naming the mesh and the shader, and its draws are skipped — nothing
throws mid-pass.

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
  per-canvas `{transparent, format}`, so one renderer can drive an opaque main
  canvas + a transparent overlay. Omitted options stick to whatever the
  canvas was last configured with (device-loss reconfigure preserves them);
  first configure falls back to the renderer defaults. Mesh pipelines follow
  a custom `format` automatically (the cache keys on the pass's formats); a
  fullscreen `RenderPipeline` blitting into that canvas must be built with
  `targets: [{format}]` — its default targets `presentationFormat` and fails
  attachment validation against a differently-formatted canvas.
- Meshes are shared, no per-canvas buffers needed — each pass writes its own
  camera slice and each draw its own object slice of the `PerDrawBuffer` (see
  below), so one scene can be drawn into N canvases within a frame.
  `UniformBuffer` values are NOT per pass (see below).
- After a device loss an extra context still holds the dead device, so it's
  reconfigured (and its depth texture remade) on the next bind.

## Transform — quaternion/rotation two-way proxy

`this.rotation` and `this.quaternion` are kept in sync via the `onChange` hooks
wired in the constructor — never replace either with a new instance, mutate in
place (`src/math/CLAUDE.md` has the full contract).

`decompose()` writes `matrix` back to position/quaternion/scale via the raw
wgpu-matrix decompose, which bypasses the `Quat` setter. It manually fires
`quaternion.onChange()` afterwards — if you decompose by any other means, do
the same or `rotation` will drift.

**Dirty tracking.** `updateMatrix()` caches the last composed TRS (`_trs`) and
skips the compose — and with it the world multiply — when position, quaternion
and scale are unchanged (values are compared, so writes through the typed arrays
are seen too); a node's world matrix is then rebuilt only when it's dirty or a
moving ancestor passes `force`. Consequences: a direct write to `node.matrix` on
an auto-updating node persists until TRS next changes; a node with
`matrixAutoUpdate = false` whose `matrix` you rewrite needs
`worldMatrixNeedsUpdate = true` (or a forcing ancestor); `setParent` marks the
world dirty; and any `updateMatrixWorld` override must forward `force` (Camera
does). `render({ updateMatrices: false })` skips the camera's update too, not
just the scene's.

## Camera — frustum extraction

`updateFrustum()` uses Gribb-Hartmann plane extraction adjusted for WebGPU's
`[0, 1]` clip-z (not GL's `[-1, 1]`). The near plane is row 3 of the projection-
view matrix alone — not `row3 + row2`. Porting frustum culling from GL without
this adjustment passes near-clipped geometry through.

`Camera.lookAt` inverts the eye/target convention vs `Transform.lookAt` — the
camera version passes `invert=true` so `+Z` aims AT the target (camera faces
forward). `Transform.lookAt` without invert aims `+Z` away from target.

## Engine block — group(1)

`Shader` appends `engine.wgsl` (after the user code, so error line numbers and
leading `enable` directives stay put): `camera` at binding 0 (176 B: projection,
view, cameraPosition, time, cameraQuaternion, resolution) and `object` at
binding 1 (240 B: model, modelView, normalMatrix `mat3x3f`, objectMatrix). The
layout is `renderer.engineLayout`, never reflected; both bindings are dynamic
offsets into the PerDrawBuffer through the one `renderer.engineBindGroup`. A
shader binding its own resource at group(1) throws at construction, and
`mesh.bindGroups[1]` must stay empty (the setter throws). A typo'd field is a
WGSL compile error — there is no by-name matching left to fail silently.

Values: `cameraPosition` = `camera.worldPosition`, `cameraQuaternion` =
`camera.worldQuaternion`, `time` = `renderer.time`, `resolution` = target size
or else the bound canvas size. With no camera (`render({ scene })`)
view/projection are identity and modelView is the world matrix.

`normalMatrix` is a Mat3 adjugate of `worldMatrix` (not the inverse-transpose
of modelView) — correct for non-uniform scale, but only valid in world space.
`normalMatrix`/`objectMatrix` live on the mesh and are recomputed only when
`Transform.worldVersion` moves (bumped in `updateMatrixWorld`, the only writer
of `worldMatrix` — anything else that writes it must bump the counter).
`modelViewMatrix` is computed per draw into a scratch matrix in
`PerDrawBuffer.writeObject`; there is no `mesh.modelViewMatrix`.

## Geometry — vertex/instance buffers are VERTEX-only by default

Geometry builds its own buffers: every attribute buffer is created with
`usage | GPUBufferUsage.VERTEX` where the extra usage defaults to 0 and data is
uploaded via `mappedAtCreation`.
So `queue.writeBuffer` on a vertex/instance buffer **fails validation silently**
(uncaptured error, draw keeps using creation contents) unless you construct the
`Geometry` with `usage: GPUBufferUsage.COPY_DST`. Anything that live-updates
vertex or instance attributes needs this. The primitive classes (`Sphere`,
`Box`, …) don't forward `usage` — use a plain `Geometry` with
`primitives.create*Vertices` (`./primitives/vertices.js`) when you need it.
`geometry.layoutKey` (its buffer layouts as JSON) is part of the pipeline-cache
key, so geometries with equal layouts share pipelines; every `@location` the
shader's `vs` reads must be in that layout or the cache reports the mesh and
skips it.

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

## Mesh / Shader / state — who owns what

`Shader` = module + reflected interface (`defs`, `uniforms` struct,
`bindGroupLayout(i)`, `pipelineLayout` with the engine layout at slot 1). Empty
group slots below the highest used group get `renderer.emptyLayout`, and a
mesh without `bindGroups[0]` (or a hole at 2–3) gets `renderer.emptyBindGroup`
there. `shader.bindGroup(group, { name: resource })` maps WGSL names to
bindings: it throws on a name the WGSL doesn't declare in that group (and on
group 1) and silently drops a declared one no entry point uses (it's absent
from the derived layout, so commenting out a read while debugging doesn't
invalidate the bind group). Resources: UniformBuffer or GPUBuffer (whole
buffer), `{ buffer, offset, size }`, views, samplers, external textures.
`shader.uniforms` is the struct of the var named `uniforms` (any binding), or
undefined; other uniform vars come from `shader.defs.uniforms.<name>`.

`Mesh` holds geometry, shader, `state` and `bindGroups` — no GPU objects, no
`gpu` (the old `new Mesh(gpu, { pipeline })` form throws). `state` is frozen on assignment (with its `blending`): the cache compares
states by identity, so swap the object (`mesh.state = glass`) instead of
mutating it. Keys: `transparent`, `depthWrite`, `depthTest`, `depthCompare`,
`depthBias`, `depthBiasSlopeScale`, `depthBiasClamp`, `cullMode`, `frontFace`,
`topology`, `blending`, `writeMask`. Defaults: `cullMode: 'back'`,
`depthWrite`/`depthTest` true, alpha blend when `transparent`, `topology:
'triangle-list'`; an explicit `undefined` keeps the default. A state or
geometry swap keeps the bind groups (same shader layouts); a shader swap needs
new ones.

`UniformBuffer` = StructView + GPUBuffer; `set()` writes and queues
`writeBuffer` at once. Values are therefore shared by every pass in one submit
(last write wins): a mesh rendered twice in one encoder with different values
needs one UniformBuffer + bind group per view, swapped via `mesh.bindGroups`
before each `render()`. After writing `ub.views` directly, call `upload()`.
`gui.uniform(ub, key)` writes through on change. A hot reload that changes the
struct size warns; rebuild the UniformBuffers and bind groups from the new
`shader.uniforms`.

**PipelineCache** (`renderer.pipelines`): key = shader id + version, state,
`geometry.layoutKey` (+ index format for strip topologies), and the pass's
colour formats + depth format + sample count (`_targetPassInfo` /
`_canvasPassInfo` mirror the pass descriptors: destroyed target textures
skipped, MSAA count from the target, depth only when attached). Each mesh
memoizes per pass kind, so a steady-state draw is identity compares only.
Labels are kebab-case (`<mesh>-<shader>-<state>-<formats>`, named after the
first mesh that built the pipeline). `renderer.compile({ scene, target })`
pre-builds with `createRenderPipelineAsync`; otherwise pipelines build
synchronously on first draw. `clear()` (device restore) bumps a generation that
invalidates every memo. Hot reload bumps `shader.version`, so pipelines rebuild
lazily on the next draw. The fragment stage is emitted only if the module has
an `fs` entry point, so a vertex-only shader is a depth-only pipeline.

**PerDrawBuffer** (`renderer.perDraw`): `Renderer.render` writes one camera
slice per pass (`writeCamera`) and every draw one object slice
(`writeObject`) into an aligned CPU mirror, and uploads every slice it
allocated in ONE `writeBuffer` (`perDraw.flush()`, right after `pass.end()` and
before the external-encoder early return), so the write is queued ahead of
whichever submit carries the pass. **A `mesh.draw()` issued outside `render()`
must call `renderer.perDraw.flush()` before its submit** (`update()` warns once
when it finds unflushed slices). The `pointer` resets once per rendered frame
(`Renderer.update`, after the paused early-return) and accumulates across every
`render()` in the frame — that's what lets one mesh draw into multiple chained
passes (shadow + main) without the second draw clobbering the first.
Overflowing (`perDrawSize`, default 1 MiB, set via the `Renderer` constructor)
logs once per frame and skips the draws that don't fit (a camera-slice overflow
skips that pass's Mesh draws; the pass still runs) — binding an offset past the
end would invalidate the whole pass. It doesn't grow: growing would invalidate
the engine bind group.

**Texture resize:** destroying/recreating a `Texture` invalidates its
`GPUTextureView`s, so any bind group holding them is stale. Rebuild the affected
group: `mesh.bindGroups[0] = shader.bindGroup(0, { …fresh views })`. For a
per-frame ping-pong, prebuild the variants and swap the slot:
`mesh.bindGroups[0] = variants[t % 2]`.

## RenderPipeline — fullscreen passes and direct draws

`RenderPipeline` is for passes with fixed geometry and a fixed target
(fullscreen post, feedback, display blits) and other non-Mesh draws: no engine
block, a fully reflected layout (`bindGroupLayout(i)` — the explicit,
hot-reload-stable BGL it built; don't reach into
`pipeline.pipeline.getBindGroupLayout(i)`), nothing dynamic. It owns no buffers
or bind groups. Its owner builds the uniform buffer
(`makeStructuredView(pipeline.defs.uniforms.uniforms)` + `createUniformBuffer`),
writes it with `queue.writeBuffer`, and binds group(0) plainly —
`pass.setBindGroup(0, bindGroup)` or through `blit(encoder, { pipeline,
geometry, targetView, bindGroup, clear })` (`@utils/RenderUtils`). It never
meets a Mesh, and target formats are declared (`targets`, default
`presentationFormat`).

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

## Reflection — `./reflect` on wgsl_reflect

Shader, RenderPipeline and ComputeShader all reflect through `./reflect`:
`reflect(code)` returns the defs every caller reads (`uniforms`, `storages`,
`textures`, `samplers`, `storageTextures`, `externalTextures`, `structs`,
`entryPoints[name].resources/inputs`), `StructView`/`makeStructuredView` lay a
reflected type out over an ArrayBuffer, and `bindGroupLayoutDescriptors`
derives layouts. Traps:

- wgsl_reflect rejects `block` as an identifier (naga and Tint accept it).
  `reflect` renames it in the parser's copy only and restores reflected names;
  add any other parser-only reserved word to `PARSER_RESERVED`. naga, in turn,
  rejects `target` — `validate:shaders` passing doesn't prove the parser is
  happy, and vice versa.
- Layouts hold only the resources an entry point uses (visibility = union of
  the stages that use them). wgsl_reflect 1.6 follows calls and switch-case
  bodies, so a binding read only inside a `case` now reaches the layout.
- Samplers reflect as `'filtering'` (or `'comparison'`); `'non-filtering'`
  can't be derived from WGSL.
- Node can't import `wgsl_reflect` bare (CJS `main` in a type:module package);
  Vite resolves its `module` field.

## ComputeShader — kernel cache invalidation

`this.kernels` object reference is stable across hot-reloads but its pipeline
values get swapped. Don't cache `kernels[name]` — re-read it at dispatch time.

`ComputeShader` is **pure compiled state** like `RenderPipeline` — it owns the
kernels + layouts, never bind groups. The caller builds its own bind group with
`device.createBindGroup` and passes it to `dispatch({ bindGroup })`. Get the
layout via `computeShader.bindGroupLayout(kernelOrKey, groupIndex)` — accepts the
kernel object (uses its `.label`) or the entry-point name string.

That layout **survives hot-reloads**: for `layout: 'auto'` the shader mints an
explicit pipeline layout per entry point _once_ (`_resolveLayout`, via
`bindGroupLayoutDescriptors` from `./reflect`) and reuses the same layout objects on every
rebuild. So a bind group the caller built at init against `bindGroupLayout(...)`
stays compatible with the reloaded pipeline — no recreation needed. The one thing
this can't absorb is a change to a shader's binding _shape_ (add/remove/retype a
binding): the persisted layout is keyed by entry-point name and won't track it —
that needs a hard reload, and the caller must rebuild its bind group.

`dispatch` creates and ends its own compute pass unless you pass an external
`pass`. The timestamp query set is only allocated when `device.features.has('timestamp-query')`
— creating one without the feature throws per spec (Renderer feature-detects it,
not guaranteed). Pass `timing: true` to add timestamp writes; it silently no-ops
without the feature, and only times passes `dispatch` creates itself.

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
leak-free. A Mesh drawn into a target picks up its formats, sample count and
depth presence automatically (PipelineCache).
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

`boneMatrixBuffer` holds final skin matrices: `updateBones()` premultiplies the
root-relative pose by the CPU bind inverse (`skin.inverseBindMatrices`) so skin.wgsl
is a plain weighted sum, no mat4×mat4 per vertex. For glTF rigs the bind inverse comes
from `inverseBindMatrices` in the file; for hand-built rigs it's FK-derived from the
bind pose. These are NOT interchangeable — don't mix sources.

`updateBones()` skips the upload (returns false) when the matrices are bit-identical to
the last upload; `update(dt, encoder?)` dispatches only if an upload happened since its
last dispatch, so a paused pose costs nothing. With `encoder` it records into the
caller's command buffer and doesn't submit. Anything else writing `skinnedPositionBuffer`
breaks that skip.

Skeleton ancestor nodes (`skeletonAncestors`) are rebuilt as live `Transform`s so
root-motion baked onto an armature ancestor (common in Mixamo) animates correctly.
Flat rigs without ancestors skip this block entirely.
