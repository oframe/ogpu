# Changelog

## Unreleased

### Removed

- **`ThreeDF` primitive.** The 3D-"F" orientation-test geometry (a thin wrap of
  webgpu-utils' `create3DFVertices`) is gone, along with its barrel export and its
  slot in the `primitives` example. webgpu-utils still ships the function if you
  want it back: `new Geometry(gpu, { data: primitives.create3DFVertices() })`.

## 0.3.0

Fullscreen/blit pass system (ported from dgpu), a feedback-trails example, and `GPUEnums`.

### Added

- **Shared fullscreen geometries + `blit` util.** `Renderer` exposes `gpu.TRIANGLE`
  (a `FullscreenTriangle`, the default) and `gpu.QUAD` (a `Quad`, for exact
  4-corner interpolation — e.g. frustum-ray depth→world reconstruction). New
  `blit(encoder, { pipeline, geometry, targetView, bindGroup, clear, label })`
  (`@utils/RenderUtils`, barrel-exported) records a color-only fullscreen pass; it
  takes the `RenderPipeline` wrapper and reads `pipeline.hasDynamicUniform` to
  decide whether group(0) needs the per-draw dynamic offset — a pass with no
  uniform binds only sampler+texture.
- **Feedback Trails example** (`?example=feedback`) — motion-trail feedback built
  on `blit`: a falling-leaves scene renders to an offscreen target, a ping-pong
  pair of accumulation textures blends it over the decayed previous frame, and a
  present blit shows the result.
- **`GPUEnums`** — frozen named-constant tables for the WebGPU string enums
  (`TextureFormat.RGBA16FLOAT`, `AlphaMode.PREMULTIPLIED`, …); string literals
  migrated to enum references across the engine and examples.
- **`RenderPipeline.hasDynamicUniform`** — true iff reflection found a used
  uniform buffer at group(0)/binding(0).

### Changed

- The `rendertotexture` example's display pass now draws the shared `gpu.TRIANGLE`
  through `blit` instead of a `FullscreenTriangle` mesh.

## 0.2.0

Port of the dgpu core audit outcome (parity-reviewed against dgpu as reference).

### Breaking

- **Per-mesh uniform buffers replaced by one renderer-owned `PerDrawBuffer`
  (dynamic offsets).** Every `Mesh.draw` allocates an aligned slice of a shared
  uniform buffer and binds group(0) with a dynamic offset — a mesh can now repeat
  across passes inside one chained-`encoder` submit (shadow + main in one command
  buffer) without uniforms stomping each other. `Mesh` no longer owns
  `uniformBuffer`; it exposes `uniformResource` (`{buffer, offset, size}`), and
  the `bindGroups` factory receives that descriptor instead of a `GPUBuffer`:
  bind it verbatim — `{ binding: 0, resource: uniformResource }`. All examples
  and `GLTFLoader` are migrated. The buffer's `pointer` resets each frame; size
  via the new `Renderer` option `perDrawSize` (default 1 MiB), overflow logs
  loudly. `group(0)/binding(0)` is marked `hasDynamicOffset` on every
  `RenderPipeline` — non-Mesh direct draws must pass `pass.setBindGroup(0, bg,
[0])`; shaders that declare but never read `uniforms` are handled via
  `RenderPipeline.hasDynamicUniform`.
- **`Renderer` `stencil` constructor option removed** — it was stored and never
  read.
- **`Geometry` without `data` now throws** with a clear message instead of
  warning and then crashing inside webgpu-utils.

### Fixed

- **Canvas transparency never worked** — the context was configured with a
  misspelled `alphamode` key (silently ignored). Now `alphaMode:
'premultiplied'|'opaque'`.
- **`ComputeShader` crashed on devices without `timestamp-query`** — timestamp
  query-set creation throws per spec; all timestamp resources are now
  feature-gated and `timing: true` degrades to a no-op (also skipped for
  external passes, which never receive timestamp writes).
- **`RenderTarget` silently flattened 3D/array/cube targets** — the
  constructor's own `onResize` wiped `depth`/`dimension`; both are now
  preserved through every resize.
- **`Geometry.destroy()` leaked index buffers** (webgpu-utils returns
  `indexBuffer` separately from `buffers`).
- **Orthographic cameras swallowed `0` extents** (`left: 0` became `-1` via
  `||`); presence-based type detection and `??` defaults.
- **Wrong-sized swapchain depth texture was never recreated** — the resize
  mismatch branch was dead code.
- **Tab-switch delta spike** — resuming after the page was hidden delivered the
  entire hidden duration as one `deltaTime`; `pause()` now actually stops the
  clock and callbacks, and resume starts with a zero-delta frame.
- **`RenderPipeline` mutated caller-owned `targets` descriptors** when applying
  blend state (shared arrays leaked blending into opaque pipelines); partial
  `blending` without `alpha` now gets the engine default instead of failing
  pipeline creation.
- **`Skin` replaced bone `position`/`quaternion`/`scale` instances**, orphaning
  the `Transform` rotation-sync hooks; bind poses are applied in place.
- **2D-array texture mip uploads shrank the layer count per mip** (only 3D
  depth shrinks); upper mips of higher layers were never written.
- **`cameraQuaternion` uniform was the camera's local rotation** — now
  world-space via the new `Camera.worldQuaternion`.
- **`resolution` uniform was always canvas-sized** — draws into a
  `RenderTarget` now receive the target's dimensions.
- **`Camera.getFrustumSize` returned half extents** (missing ×2).
- **A superseded device's late `lost` event could re-init over a healthy
  replacement**; device-loss recovery failures now log an honest
  recovery-specific error instead of the boot-time message.
- **Instanced attribute shader locations could collide** when vertex data spans
  multiple buffer layouts — locations now derive from all layouts.

### Changed

- `Mesh.draw` always calls `setPipeline` — the redundant-bind skip cache
  desynced when external code set a pipeline on a shared pass.
- `gui.uniform(target, key)` requires only `.uniforms` + `.gpu`;
  `.uniformBuffer` is optional (passes with private buffers keep immediate
  writes; meshes upload on next draw).
- Texture and depth views are cached per texture generation instead of being
  recreated every frame (invalidated through destroy/resize/device-restore).

## 0.1.3

### Changed

- **`webgpu-spec-lookup` skill — W3C spec lookups now run against a cached,
  preprocessed local copy instead of a `WebFetch` per question.** A new
  `update_spec.py` downloads `https://www.w3.org/TR/webgpu/` at most once per day
  (re-fetching only when the cached copy's date differs from today), strips it to
  ~628 KB of greppable text (from 4.5 MB of HTML), and prefixes every heading with
  its `[#anchor]` so a grep hit traces straight back to a spec section.

    **Benefits:** spec answers go from a slow, lossy whole-page fetch to a near-instant
    local `grep` — exact identifiers and limit values (`GPUFeatureName`,
    `GPUSupportedLimits`, default limits) come back verbatim instead of summarized, and
    repeat lookups in a session reuse the same-day cache. Chrome "What's New" lookups
    still use `WebFetch`. The downloaded cache (`webgpu-spec.txt`) is gitignored.
