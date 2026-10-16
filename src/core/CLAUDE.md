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
pipeline is reported once by the cache, synchronously — `shader.device` isn't
the renderer's — so no mesh draws with a dead shader's pipeline). A shader
rebuilt in place while its geometry or bind groups are still the dead
device's will draw and fail validation — rebuild all of them. There's no automatic scene rebuild —
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
PipelineCache, naming the mesh and the shader, and the draws of every mesh with that
pipeline key are skipped — nothing throws mid-pass. The key retries when the shader is
rebuilt (`version` moves), the state or geometry layout changes (a new key), or the
cache is cleared. One gap remains: an async validation
failure is known only when its error scope resolves, so draws encoded before then use
the invalid pipeline (one frame or so); a failed key then bumps `generation`, which also
re-encodes RenderBundleGroup bundles. A RenderBundleGroup leaves pipeline-less meshes out of its
bundle (warned once per `record()`) and re-encodes as soon as one has a pipeline.

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
- Meshes are shared, no per-canvas buffers needed — each render() takes its own
  camera slot and each mesh has one object slot of the `PerDrawBuffer` (see
  below), so one scene can be drawn into N canvases within a frame. Object
  slots and `UniformBuffer` values are NOT per pass (see below).
- After a device loss an extra context still holds the dead device, so it's
  reconfigured (and its depth texture remade) on the next bind.

## Transform — quaternion/rotation two-way proxy

`this.rotation` and `this.quaternion` are kept in sync via the `onChange` hooks
wired in the constructor — never replace either with a new instance, mutate in
place (`src/math/CLAUDE.md` has the full contract).

`decompose()` writes `matrix` back to position/quaternion/scale via the raw
`@utils/Mat4Utils` decompose, which bypasses the `Quat` setter. It manually fires
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

## Engine block — groups 1 and 3

`Shader` appends `engine.wgsl` (after the user code, so error line numbers and
leading `enable` directives stay put): `camera` at binding 0 (176 B: projection,
view, cameraPosition, cameraQuaternion, viewport), `object` at binding 1 (176 B:
model, normalMatrix `mat3x3f`, objectMatrix), dynamic offsets into the
PerDrawBuffer through the one `renderer.engineBindGroup` (layout
`renderer.engineLayout`, never reflected); and `time` at group(3) binding 0
(`time`, `delta`), the PerDrawBuffer's fixed time slot bound through
`renderer.timeBindGroup` (layout `renderer.timeLayout`; rebuilt on growth like
`engineBindGroup`). group(1) is re-set every draw
(its object offset moves), so it holds nothing else: each extra entry costs per
draw (a third binding, used or not, measured +10–18% Chrome GPU-process time on
highmeshcount, Dawn/Metal). group(3) is set once per pass. Users get groups 0 and 2. A shader binding its own resource at
group(1) or group(3) throws at construction, and `mesh.bindGroups[1]` and
`[3]` must stay empty (the setter throws). A typo'd field is a
WGSL compile error — there is no by-name matching left to fail silently.

Values: `cameraPosition` = `camera.worldPosition`, `cameraQuaternion` =
`camera.worldQuaternion`, `viewport` = target size or else the bound canvas
size; `time.time` = `renderer.time`, `time.delta` = `renderer.deltaTime` (both
seconds). With no camera (`render({ scene })`) view/projection are identity.
`render()` writes the time slot only when the clock changed since the last
write (later render()s in a frame write nothing); it uploads in the same
`flush()` as the camera slot, with no `writeBuffer` of its own. Like any uniform
it holds one value per submit: two render()s in one external-encoder submit with
different times both see the last. The engine declares module-scope `time`, so a
Mesh shader can't declare its own (WGSL module names share one namespace);
fullscreen RenderPipelines and ComputeShaders have no engine block and pass time
in their own uniforms.

There is no stored modelView: the object block depends on the mesh alone, not
the camera. Per vertex write
`camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * p))` —
WGSL `*` is left-associative, so `P * V * M * p` would do two mat-mat products
per vertex; `modelViewMatrix()` (engine.wgsl) is there for code that needs the
matrix itself. Shaders that share depth (prepass + `depthCompare: 'equal'`)
must use the same association.

`normalMatrix` is a Mat3 adjugate of `worldMatrix` (not the inverse-transpose
of modelView) — correct for non-uniform scale, but only valid in world space.
`normalMatrix`/`objectMatrix` live on the mesh and are recomputed only when
`Transform.worldVersion` moves (bumped in `updateMatrixWorld`, the only writer
of `worldMatrix` — anything else that writes it must bump the counter), and
only if the mesh's shader reads them: `Shader.needs` is a text check of the
user code for `normalMatrix` / `objectMatrix` (comments count — it errs toward
computing). Unread ones are neither computed nor written to the slot, so
`mesh.normalMatrix`/`objectMatrix` can be stale on the CPU — call
`mesh.updateDerived()` (no argument computes both) before reading them in JS.

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

Indirect draws: `geometry.drawBuffer` holds the args and `drawBufferOffset`
(bytes, default 0) says where this geometry's args start, so several geometries can
share one packed args buffer (a GPU culling pass writing one set per bucket).

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

## Scissor — per node, attachment pixels

`node.scissor = { x, y, width, height }` clips that node and its whole subtree;
nested scissors intersect (`Renderer.resolveScissor`), and a draw clipped to
nothing is skipped before `draw()`. Units are **attachment pixels**: device px on
the canvas (multiply CSS px by `renderer.dpr`), texels on a RenderTarget, origin
top-left. Values are rounded and clamped to the target, so an oversized rect is
safe; a non-finite field makes that scissor ignored (one warning). Scissor is
sticky pass state: the renderer only calls `setScissorRect` when the resolved
rect changes, so a scene without scissors costs no extra calls. It applies to
`render()` only, not to `blit`/fullscreen passes, which set their own state.

## Mesh / Shader / state — who owns what

`Shader` = module + reflected interface (`defs`, `uniforms` struct,
`bindGroupLayout(i)`, `pipelineLayout` with the engine layout at slot 1 and the
time layout at slot 3). Slots 0 and 2 without a user group get
`renderer.emptyLayout`, and a mesh without `bindGroups[0]` or `[2]` gets
`renderer.emptyBindGroup` there. Bind groups come from layouts, never from the shader:
`shader.bindGroupLayout(group).createBindGroup({ name: resource })`. The
`BindGroupLayout` (`./BindGroupLayout.js`, also what RenderPipeline and
ComputeShader hand out) maps WGSL names to bindings: it throws on a name the
WGSL doesn't declare in that group, silently drops a declared one no entry
point uses (it's absent from the derived layout, so commenting out a read while
debugging doesn't invalidate the bind group), and throws when a binding of the
layout is missing, `undefined` or `null`, listing what it needs. `bindGroupLayout(1)`
and `bindGroupLayout(3)` throw (the engine's groups). Resources: UniformBuffer or GPUBuffer (whole
buffer), `{ buffer, offset, size }`, views, samplers, external textures. Each
call allocates a GPUBindGroup: build once, rebuild only when a resource changes.

`BindGroupLayout`s are interned per device (a WeakMap, so a restored device
starts fresh): the raw `.layout` by shape (entries incl. visibility and the
buffer/texture/sampler/storageTexture/externalTexture fields), the engine object by shape + group + names +
declared. Equal explicit layouts are group-equivalent, so two kernels reading
the same bindings get the same object (`===`) and share bind groups, and two
modules with the same shape but other names get different objects over one raw
layout. Interning keeps the first creator's `label`, so an error can name
another shader built from the same code. Don't merge layouts across kernels: a
dispatch's usage scope covers every binding in its layout, so a combined layout
turns legal per-kernel aliasing (src/dst of one texture) into a validation error.
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

`UniformBuffer` = StructView + GPUBuffer, and the only way to back a uniform
struct — mesh, fullscreen (`pipeline.defs.uniforms.x`) and compute
(`computeShader.defs.uniforms.x`) alike. Structless bytes (SH coefficients,
strided param slots) go in `createBuffer(gpu, { usage: UNIFORM | COPY_DST, data })`
(`@utils/BufferUtils`; `data` fills it at creation, `size` defaults to its byte
length rounded up to 4; an explicit one must be a multiple of 4); `createUniformBuffer` is a deprecated alias that warns
once. `set()` writes and queues `writeBuffer` at once. Values are therefore shared by every pass in one submit
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

**PerDrawBuffer** (`renderer.perDraw`) — fixed slots, written only when they
change:

- Every mesh gets a permanent object slot on its first draw (`mesh._slot`) and
  rewrites it only when its `worldVersion` moved or its shader's `needs` grew. A
  static mesh costs no upload at all; each `render()` uploads its camera slot.
- Each `render()` takes the frame's next camera slot (sequential, restarted by
  `reset()` at each `Renderer.update`, after the paused early-return), rewritten
  every pass. Offsets are stable frame to frame only while the frame's render()
  sequence is — a conditional render() shifts the camera slots of every later
  one. Driving render() outside `Renderer.update` means calling
  `perDraw.reset()` per frame yourself, or camera slots pile up (warned at 1024).
- Slot 0 is the time slot (`perDraw.timeOffset`, group(3)), acquired in the
  constructor and never released, so the first camera slot follows it and one
  span uploads both. `writeTime()` marks it only when a value changed.
- `flush()` (end of `render()`, right after `pass.end()` and before the
  external-encoder early return) uploads the dirty slots: one `writeBuffer` over
  the dirty span while it is at most 4× the dirty count, else one per contiguous
  run. **A `mesh.draw()` issued outside `render()` must call
  `renderer.perDraw.flush()` before its submit** (`update()` warns once when it
  finds pending slots).
- **One value per slot per submit.** Writes are mirrored and uploaded before the
  submit, so a mesh drawn twice in one external-encoder chain with a different
  transform in between shows the last one in both passes (warned once per
  buffer). Drawing an unmoved mesh into several passes of one submit (shadow +
  main) is fine — the object block holds no camera data — and self-submitting
  `render()`s are fine whatever moves: queue order separates them — but one
  in the middle of an open external-encoder chain bumps the epoch, so a move
  across it inside that chain isn't warned.
- Slots come back through `mesh.destroy()`, or a `FinalizationRegistry` when a
  mesh is dropped without it. Not "unseen for N frames": a hidden mesh must
  keep its slot (anything that bakes the offset relies on it), and GC is the
  only signal that nothing can draw it again. A released slot is reusable only
  after the next `reset()` — an encoded, unsubmitted draw may still read it.
- The buffer doubles when it runs out (`perDrawSize`, default 1 MiB, is the
  starting size; size it for meshes + camera slots + the time slot). Growth
  bumps `generation`: `renderer.engineBindGroup` and `timeBindGroup` (getters)
  are rebuilt on next read, draws already encoded keep the old buffer
  (its pending slots are uploaded first; it's destroyed at the next frame
  start). There is no cap below `maxBufferSize`.
- After a device restore a mesh that never draws again still points at the old
  buffer (`_slotOwner`), keeping its CPU mirror alive; drawing it moves it over.

**Redundant state is skipped.** `Renderer.render` hands every draw one
`BoundState` per pass (a fresh one per `render()`, so a callback that renders
into another pass mid-loop doesn't corrupt it), so a draw re-sets only the pipeline, bind groups and
vertex/index buffers that differ from the previous draw's (group(1) is always
set: its offsets differ). Groups 2 and 3 are bound once per encoder by
`bindPassGroups` (`./Mesh.js`: the empty group 2 + the time group, `bound.g2`
seeded): at each bundle's start, and on the pass before the first live draw
(after any `executeBundles`, which leaves the pass with nothing bound; the
renderer resets `bound` there, and skips the call when the live queue is empty).
A draw never touches group 3 and swaps group 2 only when its own (or the empty
one after a mesh that had one) differs — one compare; a draw on an unseeded
`bound` binds group 3 itself, and one without `bound` sets both. Scissor
changes don't touch `bound`. Anything that encodes into the pass between draws
must `reset()` it. Callbacks get no pass.

**Texture resize:** destroying/recreating a `Texture` invalidates its
`GPUTextureView`s, so any bind group holding them is stale. Rebuild the affected
group: `mesh.bindGroups[0] = shader.bindGroupLayout(0).createBindGroup({ …fresh views })`. For a
per-frame ping-pong, prebuild the variants and swap the slot:
`mesh.bindGroups[0] = variants[t % 2]`.

## RenderBundleGroup — recorded draws, replayed

`RenderBundleGroup` (a `Transform`) draws its Mesh descendants from a
`GPURenderBundle` instead of one by one. `group.record()` is the only moment the
draw list is captured: it snapshots the visible meshes, sorted by shader, state,
geometry and first bind group, and the renderer encodes one bundle per pass kind
(formats + sample count + camera slot) on first use. Nothing re-records on its
own.

**When it fits** — a large opaque set whose draw list is fixed: scenery, a
city block, thousands of props. Children may still move: each keeps its fixed
engine slot, rewritten when its `worldVersion` moves, and the bundle reads it
through an offset frozen at encode time. Measured on
`highmeshcount` (10000 meshes, recorded vs live): `render()` CPU 5.80 → 0.79 ms
static, 5.90 → 0.74 ms orbiting, 10.8 → 7.9 ms with every child moving; frame
wall −64% static (−26% at 1000 meshes). GPU time rises (+60%) because the
group draws all 10000 where the culled live path drew 5780.

**When it doesn't** — anything the renderer decides per frame: frustum culling
(a group draws everything it recorded), transparent sorting (the replay runs
before every live draw, in record order), `renderOrder`, `onBeforeRender`, or
content whose shader / `state` / geometry / bind groups swap often (each swap
needs a `record()`: 10000 meshes measured 2 ms to record plus 4.4 ms for the frame that
re-encodes, against 6.9 ms for a live frame).

- **What a camera move costs:** one camera slot. The object block holds no
  camera data (0.11.0), so a moving camera rewrites nothing per child.
- **`stale`** is true when the child set, a `visible`, a shader (or its hot
  reload `version`), `state`, `geometry`, `bindGroups` (array or entries), or a
  geometry's `drawBuffer` / `drawBufferOffset` changed since `record()` (not
  `manualRender`, `renderOrder`, `frustumCulled`, callbacks or a child scissor
  set later — the replay ignores those anyway). It walks
  the whole recording (O(descendants)), so sample it. A stale group keeps
  replaying what it recorded and warns once; you decide when to `record()`.
- **Engine-side changes re-encode the same recording** without a `record()`:
  a replaced engine buffer (growth or device restore), a cleared pipeline cache, or a
  recorded mesh that came back with another slot (destroyed, or drawn by another
  renderer), a pipeline key failing asynchronously (`generation` bump), or a mesh
  the bundle left out for lack of a pipeline getting one. A bundle over a destroyed
  buffer can't replay at all. (A recovery by swapping shader/geometry still leaves
  the group `stale` and warning, though it re-encodes and draws.)
- **Never recorded** → warned once, its children are not drawn. Its subtree
  never enters the live queue either way, and an emptied group still replays
  its last recording — hide it or `record()` it empty.
- A RenderBundleGroup inside another is just part of the outer recording: the
  queue walk stops at the outer group, so the inner one's `record()` is unused.
- The recording holds its meshes strongly: a child removed and dropped is not
  collected (nor its slot freed) until the next `record()`.
- `record()` warns once when it captures a transparent, depth-test-off,
  `renderOrder`'d or callback mesh: the replay ignores all of that.
- Bundles are kept per pass kind + camera slot (the 16 most recently used per
  group; a group drawn in more passes per frame re-encodes every frame). Driving
  `render()` outside `Renderer.update` without `perDraw.reset()` moves the camera
  slot every call, so every frame re-encodes — reset once per frame.
- **GPU culling still works:** a mesh whose geometry draws indirectly
  (`drawBuffer` + `drawBufferOffset`) is recorded as `drawIndexedIndirect` /
  `drawIndirect`, so a compute pass rewriting the args each frame changes what
  the bundle draws without re-recording. Moving `drawBufferOffset` or swapping
  `drawBuffer` makes the group stale. Instance counts of non-indirect instanced
  geometry are baked at encode.
- **Scissor:** a bundle can't set one; executeBundles keeps the pass's scissor
  (only pipeline, bind groups and buffers are reset after it). Each group replays
  under its own resolved scissor (`resolveScissor(group)`), and a group clipped
  to nothing is skipped. A child's own `scissor` can't apply inside a recording —
  `record()` warns once; keep such a child outside the group.
- **Lower level:** `group._bundleFor(renderer, passInfo, cameraOffset)` is what
  `render()` calls; a custom pass should go through `render({ encoder })`
  instead.

## RenderPipeline — fullscreen passes and direct draws

`RenderPipeline` is for passes with fixed geometry and a fixed target
(fullscreen post, feedback, display blits) and other non-Mesh draws: no engine
block, a fully reflected layout (`bindGroupLayout(i)` — the interned,
hot-reload-stable BindGroupLayout; don't reach into
`pipeline.pipeline.getBindGroupLayout(i)`), nothing dynamic. It owns no buffers
or bind groups. Its owner backs the uniform struct with
`new UniformBuffer(gpu, pipeline.defs.uniforms.uniforms, values)`, builds the
bind group with `pipeline.bindGroupLayout(0).createBindGroup({ … })` and binds it plainly —
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

## Reflection — `./reflect` over webgpu-utils

Shader, RenderPipeline and ComputeShader all reflect through `./reflect`.
`reflect(code)` is webgpu-utils' `makeShaderDataDefinitions` (pinned 2.1.1, its
bundled wgsl_reflect) plus `inputs` on every entry point — the @location
parameters, scanned from the source on first read (only PipelineCache's
vertex-input check reads them). `StructView`/`makeStructuredView` lay a
reflected type out over an ArrayBuffer (`makeTypedArrayViews`, with a local
`setStructuredView`: the library's measured 1.9× slower per `set()`), and
`bindGroupLayoutDescriptors(defs, names, { skip })` derives layouts (one entry
point per stage). Traps:

- The parser rejects `block` as an identifier and typed integer const
  expressions (`const M: u32 = (1u << 19u) - 1u;` → "Invalid cast from f32 to
  u32"). Both are bridged on a parse-only, comment-free copy (`block` renamed,
  then restored in every reflected name; the const loses its type). Anything
  else the parser rejects throws at Shader / RenderPipeline / ComputeShader
  construction with the label attached. naga, in turn, rejects `target` —
  `validate:shaders` passing doesn't prove the parser is happy, and vice versa.
- Layouts hold only the resources an entry point uses (visibility = union of
  the stages that use them), following helper calls and switch-case bodies —
  not a `switch` selector: a binding read only there is dropped.
- Every `texture_*<f32>` binding reflects as `sampleType: 'float'`; samplers as
  `'filtering'` (or `'comparison'`) — `'unfilterable-float'` / `'non-filtering'`
  can't be derived from WGSL.
- `StructView` f16 scalars are Uint16Array (raw bits), f16 vectors and matrices
  Float16Array (values) — on Chrome/Edge < 135 the `@utils/float16-shim` stub,
  so raw bits there too (warned once); plain-number 16float texture data is
  truncated and wrapped to uint16 there (textureFromSource warns once). Import
  webgpu-utils only through `@utils/webgpu-utils`, which defines the stub before
  the library loads and deletes the global after (lint-enforced).
- Don't call webgpu-utils' `setIntrinsicsToView` — it's global and reshapes
  every struct view's arrays.

## ComputeShader — kernel cache invalidation

`this.kernels` object reference is stable across hot-reloads but its pipeline
values get swapped. Don't cache `kernels[name]` — re-read it at dispatch time.

`ComputeShader` is **pure compiled state** like `RenderPipeline` — it owns the
kernels + layouts, never bind groups. The caller builds its own bind group with
`computeShader.bindGroupLayout(kernelName, group).createBindGroup({ … })` and
passes it to `dispatch({ bindGroup })`. Both arguments are required — a kernel
(entry-point) name string and a group number; a kernel object, a missing group
or a bare number throws. Uniform structs go on a `UniformBuffer` from
`computeShader.defs.uniforms.<name>`.

For `layout: 'auto'` each build derives an explicit pipeline layout per entry
point (via `bindGroupLayoutDescriptors` from `./reflect`) holding only what that
kernel uses, from interned BindGroupLayouts. So a reload that keeps a kernel's
binding shape keeps bind groups built at init valid (and hands back the same
objects while names stay too); a reload that changes the shape yields new layouts, and the caller must
rebuild its bind groups. One resource object can feed several kernels' layouts
(each drops the names it doesn't read): build a shared base and spread
per-kernel overrides over it. With an explicit caller `layout`, bindGroupLayout
wraps that pipeline's raw layout, not interned: its names — and the bindings
createBindGroup requires — are every binding the module declares in the group,
so the caller's layout must hold all of them. Aliases (two vars on one binding)
get one name per binding: the kernel's own, else the first reflected; the other
is dropped like any declared name outside the layout.

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
