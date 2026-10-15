# Changelog

## 0.11.0

The engine object block no longer depends on the camera. Breaking for shaders that read
`object.modelViewMatrix`. Ported from dgpu 0.10.0.

### Changed

- **`object.modelViewMatrix` is gone** from the engine block: `struct Object` is model,
  normalMatrix, objectMatrix (240 → 176 B). A camera move no longer touches any object slice,
  and the CPU no longer multiplies view × model per draw. Per vertex, write
  `camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * p))`: three mat-vec
  products, where the old `camera.projectionMatrix * object.modelViewMatrix * p` did a mat-mat
  product per vertex (WGSL `*` is left-associative). Migrate:
  `object.modelViewMatrix * v` → `camera.viewMatrix * (object.modelMatrix * v)`.
  `modelViewMatrix()` in `engine.wgsl` returns the matrix for code that needs it (a
  module-scope `modelViewMatrix` of your own now collides with it). Every shader in `src/` and
  `examples/` is migrated, as are the scaffold skills and the shadow-mapping skill; the
  `camera.projectionMatrix * camera.viewMatrix * worldPos` chains (pbr, shadow receivers,
  skinned glTF, its shadow caster) are re-associated the same way.
- **Only the derived matrices a shader reads are computed and written.** `Shader.needs`
  (`NEEDS_NORMAL | NEEDS_OBJECT`, from `@core/Shader`) is a text check of the user code for
  `normalMatrix` / `objectMatrix`; a mesh whose shader doesn't mention them skips the adjugate /
  the 4×4 inverse and leaves those bytes alone. `mesh.normalMatrix` / `objectMatrix` can
  therefore be stale on the CPU; `mesh.updateDerived()` (no argument) makes both current. A
  shader swap or hot reload that adds a need computes it on the next draw.
- `PerDrawBuffer.writeObject(mesh)` drops its `camera` argument; `OBJECT_SIZE` is 176.

### Measured

`highmeshcount` with a seeded scene and a pinned camera (581 of 1000 / 5780 of 10000 meshes
drawn), Apple M1 Pro, headless Chromium, against 0.10.1: medians of 4 interleaved page
loads, best of 5 × 300 frames (× 40 at 10000). CPU = synchronous `render()`, wall = pipelined
frame time to `onSubmittedWorkDone`. The A/A noise floor of the same setup is about ±3% at
1000 meshes and ±10% at 10000.

| case                    | CPU ms        | wall ms       |
| ----------------------- | ------------- | ------------- |
| 1000 static             | 0.559 → 0.533 | 0.577 → 0.542 |
| 1000 every mesh moving  | 0.918 → 0.885 | 0.926 → 0.889 |
| 1000 camera orbiting    | 0.577 → 0.537 | 0.582 → 0.551 |
| 10000 every mesh moving | 17.4 → 14.8   | 17.5 → 15.0   |

0.9.0 had measured 1000 meshes all moving at +10% over 0.8.0 (every moved mesh computed the
`objectMatrix` inverse); against 0.8.0 this release is −2% there (0.921 → 0.901 ms) and
−26% static. GPU time (frames batched into one submit) and the summed per-pass GPU time of
`skinning`, `skinninggltf`, `gltf`, `instancing`, `pbrshader` and `highmeshcount` are
unchanged within noise. Screenshots of every example match 0.10.1.

## 0.10.1

### Added

- **Scissor testing** (also released on the 0.8 line as 0.8.1). `node.scissor = { x, y, width,
  height }` on any `Transform` clips it and its subtree; nested scissors intersect, and a draw
  clipped to nothing is skipped. Units are attachment pixels (device px on the canvas, texels
  on a RenderTarget), origin top-left; rects are rounded and clamped to the target, and a
  scissor with a non-finite field is ignored with one warning. `setScissorRect` is only issued
  when the resolved rect changes, so scenes without scissors make no extra calls.
  `renderer.resolveScissor(node, width, height, out?)` exposes the resolution. Folded in from a
  patch written for a client project on ogpu, with the same API.

## 0.10.0

The math library is in-house: a function layer written from scratch replaces `wgpu-matrix`, and
ogpu has no math dependency. The classes' API is unchanged. Ported from dgpu 0.9.0 + 0.9.1.

### Added

- **`@math/functions`** — `vec2`, `vec3`, `vec4`, `quat`, `mat3`, `mat4` namespaces of plain
  functions (`import { mat4, vec3 } from '@math/functions'`, also re-exported from `@math` and
  `ogpu`). Same signatures and semantics as the wgpu-matrix 3.x functions ogpu used: out param
  last and optional (a `Float32Array` is allocated when it's omitted), always returned, and it
  may alias any input. Column-major, mat3 padded to 12 floats, perspective/ortho depth in
  [0, 1] (`far = Infinity` supported). Only the 90 functions ogpu calls exist — dgpu's
  `mat4.create`, `mat4.invert` and `vec3.sub` are left out.
- Fixed-size ops are written out per lane: each of vec2/vec3/vec4 spells out its componentwise
  ops, and the identities, `perspective`/`ortho`, `mat3.copy`, `mat4.copy` and the
  `translate`/`rotateX|Y|Z` column copies write each lane instead of using `fill`/`set` (dgpu
  measured a shared loop 1.1–1.7× slower, 2–5× at mixed-type call sites, and `fill`/`set`
  1.3–3×). `mat4.scale`/`getScaling` keep their 3-iteration loops. Hot paths allocate nothing.

### Changed

- `Vec2`–`Vec4`, `Quat`, `Mat3`, `Mat4`, `Euler`, `Mat3Utils` and `Mat4Utils` sit on the
  function layer. Outputs match wgpu-matrix 3.4.2 bit for bit on Float32Array, Float64Array
  and plain-array inputs, except `determinant` (≤ 1.9e-14 relative, floored at 1), with
  Float64 inputs `inverse` (≤ 1.2e-13), and the `rotationTo` fix below; class methods match
  the old classes the same way. Screenshots of every example match the 0.9.0 baseline. CPU
  on `highmeshcount` is unchanged
  within noise: `render()` 0.502 → 0.502 ms at 1000 meshes and 7.99 → 8.05 ms at 10000 static,
  0.665 → 0.664 / 8.86 → 8.67 ms with every mesh moving (mean of three interleaved page loads,
  best of 7 each).
- `mat3.copy` / `mat3.identity` also write the padding slots 3/7/11 (copied / zeroed).
  `mat3.copy` reads exactly 12 floats: a shorter source leaves NaN in the missing slots.
- A plain-array `out` works at any length (lanes are written by index).

### Fixed

- **`quat.rotationTo` / `Quat.setFromUnitVectors` with antiparallel vectors** (dot < -0.999999)
  return a real 180° turn `(axis, 0)`, axis = normalize(x̂ × a), or ŷ × a when a is near ±x̂.
  wgpu-matrix 3.4.2 returned the degenerate `(0, 0, 0, cos(π/2))`, which acts as no rotation.

### Removed

- **`wgpu-matrix`** (dependency and imports).

### Migration

1. `import { mat4, vec3 } from 'wgpu-matrix'` → `import { mat4, vec3 } from 'ogpu'` (examples) or
   `from '@math/functions'` (inside `src/`). Call sites don't change.
2. Only the functions ogpu uses exist. A missing one (`mat4.rotation`, `vec3.clamp`, …) means
   adding it to `src/math/functions/` with the same out-last contract.
3. Never take `subarray()` or a partial `slice(a, b)` of a math class instance — species
   construction returns a fresh full-size instance, not a view (see `src/math/CLAUDE.md`).

## 0.9.0

Meshes hold a Shader, a plain `state` object and bind groups; the renderer derives their
pipelines, engine uniforms live in one fixed group(1), and webgpu-utils is gone. Ported from
dgpu 0.8.0. Breaking.

### Added

- **`Shader`** (`@core/Shader`, exported from `ogpu`) — a shader module plus its reflected
  interface: the `uniforms` struct, `bindGroupLayout(i)` and a pipeline layout with the engine
  layout at slot 1. It knows no geometry, target or blend state.
  `shader.bindGroup(group, { uniforms, tMap: view, … })` binds by WGSL name: undeclared names
  throw, declared-but-unused ones are dropped, group 1 is refused. Hot reload rebuilds it in
  place and bumps `version`.
- **`UniformBuffer`** (`@core/UniformBuffer`, exported) — a struct view plus its GPUBuffer, built
  from any reflected struct (`new UniformBuffer(gpu, shader.uniforms, values)`). `set()` uploads
  immediately. `gui.uniform(ub, 'uScale', …)` binds it.
- **Engine block** (`src/core/engine.wgsl`), appended after the user code of every Mesh shader
  (line numbers and `enable` directives stay put): `@group(1) camera` (projectionMatrix,
  viewMatrix, cameraPosition, time, cameraQuaternion, resolution; 176 B, one slice per pass)
  and `@group(1) object` (modelMatrix, modelViewMatrix, normalMatrix, objectMatrix; 240 B, one
  slice per draw). Both are dynamic offsets into the PerDrawBuffer through one renderer-owned
  bind group, rebuilt on device restore. Field names are declarations now, so a typo is a
  compile error and the misspelling warning is gone. With no camera the matrices are identity.
- **`PipelineCache`** (`renderer.pipelines`, exported) — GPURenderPipelines derived from
  (shader + version, `state`, `geometry.layoutKey`, the pass's colour/depth formats + sample
  count), memoized per mesh and pass kind, with kebab-case labels. A pipeline that can't be
  built, or a shader input the geometry doesn't provide, is reported once naming the mesh and
  the shader, and that mesh's draws are skipped. **`renderer.compile({ scene, target })`**
  pre-builds with `createRenderPipelineAsync`.
- **`Transform.worldVersion`** — bumped whenever the world matrix is recomputed; a Mesh caches
  `normalMatrix` / `objectMatrix` against it.
- **Internal reflection** (`src/core/reflect`) on `wgsl_reflect` 1.6.0 (pinned): `reflect(code)`,
  `StructView` / `makeStructuredView` (same `views` / `set` / `arrayBuffer` shape as before, all
  exported from `ogpu`) and per-entry-point layout derivation. Parity-checked against
  webgpu-utils over every `.wgsl` in the repo.
- **`@core/primitives/vertices.js`**, **`@utils/mipmap.js`** (`generateMipmap(gpu, texture)`,
  `numMipLevels`) and **`@utils/textureFromSource.js`** — ports of the webgpu-utils pieces ogpu
  used, byte-identical output, MIT attribution kept. Geometry builds its own vertex/index
  buffers.
- **`validate:shaders`** understands `// validate-prepend: <file>` (Mesh shaders name
  `src/core/engine.wgsl`), hoisting `enable` / `requires` / `diagnostic` above the prepended code.

### Changed

- **`new Mesh({ label, geometry, shader, state, bindGroups, renderOrder, frustumCulled,
manualRender })`** — no `gpu`, no `pipeline`, no per-mesh GPU objects. `geometry`, `shader`,
  `state` and `bindGroups` are all swappable (bind groups belong to their shader);
  `bindGroups[1]` must be empty, and empty slots get the renderer's shared empty group.
- **`state`** — a plain object, frozen on assignment (its `blending` too); replace it, don't
  mutate it. `transparent`, `depthWrite`, `depthTest`, `depthCompare`, `depthBias`,
  `depthBiasSlopeScale`, `depthBiasClamp`, `cullMode`, `frontFace`, `topology`, `blending`,
  `writeMask`. Defaults match the old RenderPipeline; an explicit `undefined` keeps the default.
- **`RenderPipeline`** is for fullscreen passes and other non-Mesh draws only: no engine block,
  a fully reflected layout, nothing dynamic. `blit` binds group(0) without the dummy `[0]`
  offset.
- **Shaders** — the ten standard fields leave every `Uniforms` struct; shaders read `camera.*`
  and `object.*`. computefrustumculling's field shader, the one that used `@group(1)` for its own
  storage buffers, moved them to `@group(2)`.
- **`pbr.wgsl`** has no `uniforms` block any more, so its group(0) starts at binding 1 — drop the
  binding-0 entry from hand-built bind groups.
- **`GLTFLoader`** builds one Shader (`loader.shader`; `loader.pipelines` is gone) and a
  UniformBuffer per material; its `targets` / `sampleCount` options are gone (formats come from
  the pass). `getSkinnedMesh` binds group(0) by WGSL name.
- **`GaussianSplat`** extends the new Mesh and keeps `uCount` in its own UniformBuffer.
- **Per-draw upload** — every draw takes one 256 B object slice plus one 256 B camera slice per
  pass. hellowebgpu: 512 → 341 B per draw (1536 → 1024 B per frame). highmeshcount, whose
  old struct already padded to 256 B: unchanged at 256 B per drawn mesh.
- **`render()` CPU time** (highmeshcount, Apple M1 Pro, headless Chromium, best of 7 runs × 3 page loads): static
  scene 0.59 → 0.51 ms at 1000 meshes (~600 drawn) and 11.4 → 7.8 ms at 10000 (~5750 drawn);
  every mesh moving every frame 10.9 → 8.6 ms at 10000, but 0.62 → 0.68 ms at 1000. Likely
  cause (not profiled): a moved mesh now always computes the `objectMatrix` inverse, which
  0.7–0.8 skipped when the shader didn't declare it (highmeshcount's didn't).

### Removed

- **`webgpu-utils`** (dependency, imports, docs, the `webgpu-utils-lookup` skill).
- `mesh.uniforms`, `mesh.uniformResource`, `mesh.structSize`, `mesh.modelViewMatrix`,
  `mesh.pipeline`, bind-group factory functions, `RenderPipeline.hasDynamicUniform`.

### Migration

1. WGSL: delete `projectionMatrix`, `viewMatrix`, `modelMatrix`, `modelViewMatrix`,
   `objectMatrix`, `normalMatrix`, `cameraPosition`, `cameraQuaternion`, `resolution` and `time`
   from your `Uniforms` struct (delete the struct and its binding if nothing is left) and read
   `camera.<field>` / `object.<field>` instead. Add
   `// validate-prepend: <path>/src/core/engine.wgsl` for `validate:shaders`. Move any own
   `@group(1)` bindings to group 2.
2. JS: `new RenderPipeline(gpu, { code, vertexBuffers, targets, sampleCount, cullMode, … })` +
   `new Mesh(gpu, { pipeline, geometry, bindGroups: (uniformResource) => […] })` becomes
   `const shader = new Shader(gpu, { code, constants })`,
   `const uniforms = new UniformBuffer(gpu, shader.uniforms, { … })`,
   `new Mesh({ geometry, shader, state: { cullMode, … }, bindGroups: [shader.bindGroup(0, { uniforms, … })] })`.
   Drop `targets` / `sampleCount` / `vertexBuffers` / depth formats.
3. `mesh.uniforms.set(…)` → `uniforms.set(…)`; `gui.uniform(mesh, …)` → `gui.uniform(uniforms, …)`.
   A mesh drawn several times in one submit with different values needs one UniformBuffer +
   bind group per view.
4. A pass that draws a mesh with another shader (shadow casters): a second Mesh sharing the
   geometry, or swap `mesh.shader` and `mesh.bindGroups` together.
5. Fullscreen / direct draws on a RenderPipeline: `pass.setBindGroup(0, group)` with no offsets.
6. `import { makeStructuredView } from 'webgpu-utils'` → `from 'ogpu'`; `primitives` →
   `@core/primitives/vertices.js`; `generateMipmap(device, tex)` → `generateMipmap(gpu, tex)`
   from `@utils/mipmap.js`.
7. After a device loss, rebuild your Shaders (and their bind groups) in a
   `deviceRestoredHandlers` callback; the renderer rebuilds its engine group and pipeline cache.

## 0.8.0

Less per-frame work: skinning and transforms now redo only what changed, ported from dgpu.

### Changed

- **Skinning premultiplies bind inverses on the CPU** — `Skin.updateBones()` uploads final skin
  matrices (root-relative pose × bind inverse), so `skin.wgsl` is a plain weighted sum instead of
  four mat4 × mat4 per vertex. Bind inverses live on the CPU as `skin.inverseBindMatrices` (glTF
  `inverseBindMatrices` when the rig ships them, else FK-derived). Output is identical to float
  noise (max 3e-7 relative across every vertex of both example rigs).
- **Idle skins skip the GPU** — `updateBones()` returns `false` and skips the upload when the
  matrices are unchanged, and `update()` dispatches only after an upload.
  `update(dt, encoder)` records into a caller's encoder when one is passed.
- **Transforms recompose only when TRS changes** — `Transform.updateMatrix` caches position,
  quaternion and scale, so static subtrees no longer recompute their world matrices every frame.
  `Camera.updateMatrixWorld(force)` forwards `force`.

### Breaking

- `skin.invBoneMatrixBuffer` and binding 4 of the skinning bind group are removed;
  `Skin.updateBones()` returns a boolean.
- A direct write to `node.matrix` on an auto-updating node now persists until its TRS next
  changes. A `matrixAutoUpdate = false` node whose `matrix` is rewritten must set
  `worldMatrixNeedsUpdate = true`.

## 0.7.0

Gaussian splatting, and a cheaper per-draw uniform path brought over from dgpu.

### Added

- **`GaussianSplat` + `loadSplat`** (`@modules/gsplat`, exported from `ogpu`) — EWA
  splat rendering with a depth sort that runs as a GPU radix or bitonic sort, a CPU
  counting sort in a worker, or a radix sort time-sliced across frames. Loads `.ply`,
  `.splat`, `.spz` (v1–3) and `.sog`. `destroy()` releases everything it owns. No
  example ships yet.
- **`Quat.setFromUnitVectors(from, to)`** — shortest-arc rotation, antiparallel-safe.
- **`blit({ depthView })`** — optional depth attachment for fullscreen pipelines that
  write `frag_depth`.

### Changed

- **One uniform upload per `render()`** — meshes copy their uniforms into a CPU mirror
  of the per-draw buffer, and `Renderer.render` uploads them in a single `writeBuffer`
  after the pass instead of one per mesh. A `mesh.draw()` issued outside `render()`
  must call `renderer.perDraw.flush()` before submitting; `update()` warns once if it
  finds unflushed slices.
- **Derived matrices only when declared** — `modelViewMatrix`, `normalMatrix` and
  `objectMatrix` (a full inverse) are computed only for shaders whose `Uniforms` struct
  reads them.
- **`ComputeShader.dispatch` is synchronous** — it never awaited anything; being
  `async` only turned throws into unhandled rejections.

### Fixed

- **Per-draw overflow no longer breaks the pass** — a draw that doesn't fit is now
  skipped (and reported once per frame). It used to bind an offset past the end of the
  buffer, which invalidates the whole render pass.
- **Opaque/transparent/UI sort** — the final tie-break compared a node `id` that doesn't
  exist; removed. Ties keep scene-traversal order.
- **`createBrdfLUT` fallback** — the `rgba16float` patch now replaces the exact
  storage-texture token instead of the first `rg16float` anywhere in the source.
- **`validate:shaders`** rejects Homebrew's unrelated `naga` (a Snake game) and falls
  back to `~/.cargo/bin/naga`.

## 0.6.1

Skill and agent-guidance fixes: the scaffolding skills emit code that matches the
per-draw uniform model again, and agent docs no longer contradict the repo.

### Fixed

- **Scaffolded apps failed `createBindGroup`** — the `scaffold-app` template (and
  the wiring snippets in `scaffold-shader`, `pbr-shading` and `shadow-mapping`)
  still bound the mesh's group-0 uniform as `{ buffer: uniformBuffer }`, a
  pre-`PerDrawBuffer` shape. The `bindGroups` factory receives a
  `{buffer, offset, size}` slice, so wrapping it again nested an object where a
  `GPUBuffer` belongs. All of them now bind `uniformResource` verbatim, and the
  stale `mesh.uniformBuffer` references are gone.
- **`scaffold-app` described the wrong `src/main.js`** — it now adds a `views` map
  entry and an `@examples/` import instead of a `switch (view)` case and a
  `./examples/` import.

### Changed

- **Agent docs corrected where the repo contradicted them:** gallery rows live in
  `items` (not `links`); KTX loading is not a gap (`KTXTexture` exists);
  `ComputeShader` only allocates its timestamp query set when `timestamp-query` is
  present; hot reload covers every `*.wgsl?raw` import, not just `src/`; the
  removed `pbrprev.wgsl` is no longer mentioned; the BRDF LUT is called out as the
  `rg16float` exception to the `rgba16float` IBL textures; "used to / no longer"
  history phrasing dropped in favour of current facts.
- **Skill templates follow the repo conventions** — vertex entry parameter named
  `in`, kebab-case labels.
- **Dependency bumps** — `postcss` 8.5.25, `js-yaml` 4.3.1, plus
  `brace-expansion` and `nanoid` patched for advisories.

## 0.6.0

A cheaper BRDF integration LUT, an analytic env-BRDF alternative to sampling it,
and a leaner agent-guidance set.

### Added

- **`Material.useBrdfApprox`** (`1` = on) in `pbr.wgsl` — swaps the `tBrdf` LUT
  sample for Karis' analytic environment-BRDF fit from "Physically Based Shading
  on Mobile", trading one texture fetch for a few ALU ops (worth it on tile-based
  GPUs; slightly off at grazing angles). It's a runtime uniform, not an override
  constant, so it toggles without a pipeline rebuild — the LUT still has to be
  bound either way. Wired to a `brdf-approx` checkbox in the `?src=pbrshader`
  example.

### Changed

- **The split-sum BRDF LUT is stored as `rg16float`**, not `rgba16float` — the
  shader only ever wrote and read two channels, so this halves the texture for
  identical output. `rg16float` as a storage binding is gated behind the
  `texture-formats-tier1` feature, so `createBrdfLUT` feature-detects it and falls
  back to `rgba16float` (patching the format into the compute source) on adapters
  without it. `pbr.wgsl` reads `.xy` either way.
- **`AGENTS.md` and the nested `CLAUDE.md` files were rightsized** for the Claude
  5 generation's context rules: procedural scaffolding and file-system-derivable
  material dropped, cross-file duplication collapsed to a single owner, tokens
  kept on the non-obvious gotchas. `AGENTS.md` went from 139 lines to 73 with no
  loss of engine-specific guidance.

## 0.5.0

Multi-canvas rendering — one device and one frame loop driving any number of canvases.

### Added

- **`Renderer.setContext(canvas)`** — points the **next** `render()` at another
  canvas; `render()` hands the default canvas back on its way out, so a binding
  lasts exactly one render (`setContext(null)` restores immediately). Each extra
  canvas is configured on first bind and carries its own depth texture, parked on
  the context object itself — `getContext('webgpu')` returns the same object per
  canvas, so the context doubles as the per-canvas record, and a device loss
  reconfigures it on the next bind. Extra canvases are **not** observed: set
  `canvas.width/height` yourself (the renderer only watches its own).
- **`Renderer.contextFor(canvas)`** — the same lazy configure **without** binding.
  Hand `blit` a `contextFor(c).getCurrentTexture().createView()` as its
  `targetView` to land composited output on another canvas; the pass pipeline's
  `targets[0].format` must be the canvas format, which every canvas here shares.

- **`?src=multicanvas` example** — eight primitives (box, sphere, torus,
  cylinder, cone, disc, ring, plane), one per canvas, in a scrollable 2×2 CSS
  grid. Backing stores follow the CSS-laid-out boxes via a `ResizeObserver`, an
  `IntersectionObserver` skips cells scrolled out of view, the page canvas is
  reused as the first cell, and every cell records into one command encoder —
  one submit per frame for the whole grid.

### Changed

- **The swapchain depth texture is sized against the bound canvas**
  (`this.gpu.canvas`) instead of `this.width`/`this.height`, which track the
  default canvas only.
- **`Renderer.render` reads as flow, not attachment plumbing.** Descriptor
  building moved into `_targetPassDescriptor` (RenderTarget/MRT, MSAA resolve,
  optional depth) and `_canvasPassDescriptor` (bound canvas + engine depth); the
  body is wrapped in the `try/finally` that enforces the one-render binding,
  including on its early returns (no device / not ready / paused).

## 0.4.0

WGSL validation tooling, and the `ThreeDF` primitive removed.

### Added

- **`naga-setup` skill** (`.claude/skills/naga-setup/`) — installs WGSL validation
  into a repo: the `PostToolUse` hook that runs `naga` on every `.wgsl` an agent
  writes, the batch `scripts/validate-shaders.mjs`, and the `naga`/`jq` toolchain
  they need. Also covers the fresh-clone case, where the hook arrives with the
  repo but the `naga` binary doesn't — leaving a hook that fires and silently does
  nothing.

### Changed

- **`npm run validate:shaders` now walks the whole repo, not just `src/`.** It was
  checking 7 of 44 shaders; the other 37 live in `examples/` and had never been
  batch-validated. Generated and vendored directories are skipped via a `SKIP` set.

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
