# AGENTS.md

Shared agent guidance for this repo. `CLAUDE.md` / `GEMINI.md` / `.cursor/rules/main.mdc` are one-line imports of this file — edit here only.

Hand-rolled WebGPU engine. Vanilla JS, Vite, no framework, no TypeScript (ambient decls in `types/ogpu.d.ts` for TS consumers). No tests, no typechecker. ESLint + Prettier, format-on-save.

## Where things are

- `api-digest.md` — generated public-surface index (every exported class, its method signatures, barrel re-exports). Read it for any signature or constructor option instead of opening the file.
- `module-graph.json` — generated import graph; `hubs` lists the highest-in-degree modules. Trace `edges` instead of grepping for importers.
- Both regenerate with `npm run repomap`. A pre-commit hook runs `repomap:check` and blocks stale copies — if a commit is blocked, `git add api-digest.md module-graph.json` and recommit.

This file is the _why_; api-digest is the _what_. Keep method lists out of here.

Each source directory has its own `CLAUDE.md` with that area's footguns, auto-loaded when you read files there:
`src/core/` (Renderer, Transform, Camera, Mesh, RecordedGroup, Shader, UniformBuffer, PipelineCache, PerDrawBuffer, RenderPipeline, Geometry, ComputeShader, Texture, RenderTarget, `reflect/`, `primitives/`, `skin/`, ShaderReload) · `src/math/` (the `@math/functions` layer — `vec2`/`vec3`/`vec4`/`quat`/`mat3`/`mat4`, out param last; `wgpu-matrix` plus local overrides, imported from here, never `wgpu-matrix` directly, lint-enforced — under chainable `Float32Array`-subclass classes) · `src/modules/` (Orbit, Raycast, GUI, Animation, GLTFLoader, CubeMap, VideoTexture, `pbr/`, `gsplat/`, `text/` (MSDF text + SplitText-style reveals)) · `src/utils/IBLUtils/`.
`src/utils/` is standalone helpers; `examples/` is runnable demos at the repo root.

`examples/` covers shadows, skinning, PBR/IBL, render targets, compute particles, glTF. Anything overlapping those extends the existing path rather than starting a new one.

## Three cross-cutting contracts

- **Pass the `gpu` object, never the raw `device`.** `Renderer.init` augments the canvas context with `.device`/`.presentationFormat`/`.renderer`; that object (`renderer.gpu`) is what every class takes and stores. It's async — `await renderer.ready` before any GPU work (it also bootstraps `window.ktx`).
- **groups 1 and 3 are the engine's.** `Shader` appends `src/core/engine.wgsl` to every Mesh shader: `camera` (`projectionMatrix`, `viewMatrix`, `cameraPosition`, `cameraQuaternion`, `viewport` — one `PerDrawBuffer` slot per render pass) and `object` (`modelMatrix`, `normalMatrix` (`mat3x3f`), `objectMatrix` — one fixed slot per mesh, rewritten only when it moves; there is no stored modelView: write `camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * p))`, right-associated so it stays mat-vec, or call `modelViewMatrix()` for the matrix), both dynamic offsets through one renderer-owned bind group; `time` (`time.time`, `time.delta` = `renderer.time`/`deltaTime` in seconds, one value per submit) is group(3): a fixed `PerDrawBuffer` slot, bound once per pass. Shaders read `camera.*`/`object.*`/`time.*` — a typo is a compile error, not a stale value; a Mesh shader can't declare its own module-scope `time`. Never redeclare those fields in your own struct or bind anything of your own at group(1) or group(3); user resources live in group(0) (2 for extras).
- **A Mesh is geometry + Shader + `state` + bind groups; the renderer derives the pipeline.** `new Mesh({ geometry, shader, state, bindGroups })` takes no `gpu` and owns no GPU objects. `state` is a plain object, frozen on assignment — replace it, don't mutate it. `renderer.pipelines` builds each pipeline on first draw from (shader + version, state, `geometry.layoutKey`, the pass's formats + sample count), so target formats are never declared; `renderer.compile({ scene, target })` pre-warms. Bind groups come from the shader's layouts (`shader.bindGroupLayout(0).createBindGroup({ uniforms, tMap })`, by WGSL name): a shader swap needs new ones, a state/geometry swap doesn't. Custom values go in a `UniformBuffer` whose `set()` uploads immediately — shared by every pass in a submit, so per-view values need one buffer + bind group per view. Details in `src/core/CLAUDE.md`.

`Renderer.render` takes an optional external `encoder` to chain passes into one submit, and `target` selects a `RenderTarget`'s attachments over the bound canvas swapchain.

**Recorded draws:** a `RecordedGroup` (src/core) replays its static subtree from a render bundle — the when-to/when-not rule and the `stale` + `record()` contract are in `src/core/CLAUDE.md`. Use it for large fixed opaque sets; never for CPU-culled, sorted-transparent or frequently swapped content.

## Coding conventions

- **Labels are kebab-case.** Every `label:` string (WebGPU debug labels, GUI display text) is lowercase-hyphenated; interpolations preserved, e.g. `` `${this.label}-bone-buffer` ``.
- **WGSL `let` vs `var`.** `let` for values that never change, `var` only where reassigned.
- **WGSL short type aliases.** `vec3f` not `vec3<f32>`, `mat4x4f` not `mat4x4<f32>` (`h` suffix for f16). Texture/atomic/array/ptr keep their generic form.
- **WGSL vertex entry parameter is named `in`** — `fn vs(in: Vertex) -> VertexOutput`, mirroring `fs`.
- **Comments earn their place.** Only when they add a why, a gotcha, or a non-obvious invariant. No `ponytail:`/agent prefixes in committed comments — keep the content, strip the prefix.
- **Use the lookup skills, don't answer from memory.** WebGPU platform questions → `webgpu-spec-lookup`. `webgpu-utils` library questions → `webgpu-utils-lookup`.

## Shaders

WGSL lives next to its importer, loaded via `?raw`. Cross-example shaders live in `src/modules/pbr/`. Aliases work in `?raw` imports (`@modules/pbr/pbr.wgsl?raw`); keep same-directory imports relative.

Conventions (reflection goes through `src/core/reflect/` on `webgpu-utils`):

- A Mesh shader starts with `// validate-prepend: ../../src/core/engine.wgsl` (from `examples/<name>/`; module shaders use their own relative path, e.g. `pbr.wgsl` → `../../core/engine.wgsl`) so `validate:shaders` sees `camera`/`object`/`time` (the validator hoists `enable` directives above prepends).
- Custom values: `var<uniform> uniforms` at `@group(0) @binding(0)`, typed as a struct holding only your own fields; `shader.uniforms` is its reflected struct (feed it to `UniformBuffer`). No custom values → no struct, no binding. `shader.uniforms` is found by the var NAME `uniforms`; other uniform vars (hellowebgpu's `scaleUniform`/`alphaUniform`, pbr's `material`) are reached via `shader.defs.uniforms.<name>`.
- Entry points: vertex `vs`, fragment `fs` (optional — a vertex-only module is a depth-only pipeline), hardcoded in `Shader`/`RenderPipeline`. Compute entry points can be anything — each becomes a kernel keyed by its name.
- `RenderPipeline` is for fullscreen passes and other non-Mesh draws only: no engine block, a fully reflected layout, nothing dynamic.
- Layouts hold only the resources an entry point actually uses (helper calls and switch-case bodies count — a `switch` selector does not: a binding read only there is dropped, so read it into a `let` first); bind groups come from the layout — `shader.bindGroupLayout(g)`, `pipeline.bindGroupLayout(g)`, `computeShader.bindGroupLayout(kernelName, g)` (both arguments required) return a `BindGroupLayout` (raw at `.layout`) whose `createBindGroup({ name: resource })` drops declared-but-unused names, throws on undeclared ones and throws on a missing binding. Layouts are interned by shape, so kernels reading the same bindings share one (and its bind groups).
- `UniformBuffer` is the only way to back a uniform struct (mesh, fullscreen and compute alike: `new UniformBuffer(gpu, defs.uniforms.<name>, values)`); raw bytes go through `createStorageBuffer` / `createBuffer` with `data` (filled at creation). `createUniformBuffer` is deprecated.
- Texture uniforms take a `t<Name>` prefix (`tMap`, `tNormal`, `tBrdf`). Samplers are not textures — descriptive names (`iblSampler`).

`npm run validate:shaders` checks every `**/*.wgsl` with `naga`, no browser needed (single file: `node scripts/validate-shaders.mjs <file>`). Install with `brew install naga-cli` — **not** `brew install naga`, an unrelated Snake game that takes the same binary name.

## Optional features are not guaranteed

`Renderer.initDevice` feature-detects its `wantedFeatures` wishlist and drops (with a warn) anything the adapter lacks, so the engine boots on any WebGPU adapter. webgpu-utils 2.x references `Float16Array` when it loads; Chrome/Edge 113–134 lack it, so `@utils/webgpu-utils` — the only module allowed to import webgpu-utils (lint-enforced) — installs a `Uint16Array`-subclass stand-in just before the library loads and deletes it right after (app code still sees no `Float16Array`). On those browsers two kinds of data degrade: f16 vector/matrix struct-view fields hold raw bits, not values (`StructView` warns once — use f32 fields or an f32 shader variant), and plain-number `*16float` texture data passed to the texture helpers is truncated and wrapped to uint16 (`textureFromSource` warns once — pass half-float bits in a `Uint16Array`, or use a 32float format). The shim, unshim and wrapper are the package's declared side effects (`sideEffects` in package.json) — keep them listed or bundlers drop or reorder them. Guard any path that needs one on `device.features.has(...)` — `TimingHelper` gates on `'timestamp-query'`, `ComputeShader` timing is opt-in via `timing: true`. Texture-compression families are platform-split (`astc`/`etc2` ≈ mobile/Apple, `bc` ≈ desktop).

## Running examples

`src/main.js` handles two query strings — don't confuse them:

- **`?example=<key>`** — user-facing gallery (sidebar + preview iframe); the iframe loads `./?src=<key>` internally. This is what you link to.
- **`?src=<key>`** — boots that example standalone on the page's own canvas, no gallery chrome.

Keys live in the `views` map, gallery rows in the `items` array inside `renderLanding()`. New example: class under `examples/<name>/`, import it in `src/main.js`, add both entries.

## Assets and external deps

- `public/assets/` — KTX cubemaps, PBR textures, JSON rigs/animations. Plain `fetch('./assets/...')`.
- `public/assets/fonts/` — MSDF text atlases. `npm run build:font` rebakes them with `msdf-atlas-gen` (msdfgen's atlas front-end; no prebuilt macOS binary — build steps in the `scripts/build-msdf-font.mjs` header; put it on PATH or set `MSDF_ATLAS_GEN`; exits 2 if absent). Other fonts: `node scripts/build-msdf-font.mjs <font.ttf> <outDir> [name]`. Fonts committed there must be redistributable and ship their licence.
- `public/libktx_read.js` + `.wasm` — Khronos KTX reader, loaded as a global `<script>` in `index.html`; `initDevice` stashes it on `window.ktx`, ready once `renderer.ready` resolves.
- `webgpu-utils` (pinned exactly, 2.1.1 — its bundled parser is part of the contract) — WGSL reflection, struct views and layout derivation under `src/core/reflect/`, plus `Geometry`'s vertex buffers, the `primitives` generators (`src/core/primitives/vertices.js`), and the mip/texture helpers behind `@utils/mipmap` / `@utils/textureFromSource`. Its parser rejects `block` as an identifier and typed integer const expressions (`const M: u32 = (1u << 19u) - 1u;`); `reflect()` bridges both on a parse-only copy, so only a raw `makeShaderDataDefinitions` call hits them. naga rejects `target`.
- `wgpu-matrix` (pinned, 3.4.2) — behind `@math/functions` only (see `src/math/CLAUDE.md`).
- `parse-exr` — EXR loading inside `@utils/IBLUtils`.
- `@utils/wgslOverrides` (`applyOverrideConstants`) — Safari lacks pipeline-overridable constants, so this bakes `override` decls into module-scope `const` literals before compile, resolving default expressions to numeric literals so the reflection parser doesn't choke.

Recurring trap across areas: destroying/recreating a `Texture` invalidates its views, so any bind group holding them is stale — rebuild it (`mesh.bindGroups[0] = shader.bindGroupLayout(0).createBindGroup({...})`, or `pipeline.bindGroupLayout(i).createBindGroup({...})` for a fullscreen pass).

Loaders exist for images (`Texture` with `src`), KTX (`@modules/KTXTexture`), JSON (`@utils/JSONLoader`), glTF (`GLTFLoader.js`) and IBL cubemaps (`@utils/IBLUtils`) — check these before writing a new one.
