# AGENTS.md

Shared agent guidance for this repo. `CLAUDE.md` / `GEMINI.md` / `.cursor/rules/main.mdc` are one-line imports of this file — edit here only.

Hand-rolled WebGPU engine. Vanilla JS, Vite, no framework, no TypeScript (ambient decls in `types/ogpu.d.ts` for TS consumers). No tests, no typechecker. ESLint + Prettier, format-on-save.

## Where things are

- `api-digest.md` — generated public-surface index (every exported class, its method signatures, barrel re-exports). Read it for any signature or constructor option instead of opening the file.
- `module-graph.json` — generated import graph; `hubs` lists the highest-in-degree modules. Trace `edges` instead of grepping for importers.
- Both regenerate with `npm run repomap`. A pre-commit hook runs `repomap:check` and blocks stale copies — if a commit is blocked, `git add api-digest.md module-graph.json` and recommit.

This file is the _why_; api-digest is the _what_. Keep method lists out of here.

Each source directory has its own `CLAUDE.md` with that area's footguns, auto-loaded when you read files there:
`src/core/` (Renderer, Transform, Camera, Mesh, RenderPipeline, Geometry, ComputeShader, Texture, RenderTarget, PerDrawBuffer, `primitives/`, `skin/`, ShaderReload) · `src/math/` (`Float32Array`-subclass wrappers over `wgpu-matrix`) · `src/modules/` (Orbit, Raycast, GUI, Animation, GLTFLoader, CubeMap, VideoTexture, `pbr/`) · `src/utils/IBLUtils/`.
`src/utils/` is standalone helpers; `examples/` is runnable demos at the repo root.

`examples/` covers shadows, skinning, PBR/IBL, render targets, compute particles, glTF. Anything overlapping those extends the existing path rather than starting a new one.

## Two cross-cutting contracts

- **Pass the `gpu` object, never the raw `device`.** `Renderer.init` augments the canvas context with `.device`/`.presentationFormat`/`.renderer`; that object (`renderer.gpu`) is what every class takes and stores. It's async — `await renderer.ready` before any GPU work (it also bootstraps `window.ktx`).
- **Standard uniforms are written by name.** `Mesh.draw` matches `projectionMatrix`, `viewMatrix`, `modelMatrix`, `modelViewMatrix`, `objectMatrix`, `normalMatrix`, `cameraPosition`, `cameraQuaternion`, `resolution`, `time` against the shader's reflected `Uniforms` struct. A misnamed field is **silently skipped** — no error, stale value. Details in `src/core/CLAUDE.md`.

`Renderer.render` takes an optional external `encoder` to chain passes into one submit, and `target` selects a `RenderTarget`'s attachments over the bound canvas swapchain.

## Coding conventions

- **Labels are kebab-case.** Every `label:` string (WebGPU debug labels, GUI display text) is lowercase-hyphenated; interpolations preserved, e.g. `` `${this.label}-bone-buffer` ``.
- **WGSL `let` vs `var`.** `let` for values that never change, `var` only where reassigned.
- **WGSL short type aliases.** `vec3f` not `vec3<f32>`, `mat4x4f` not `mat4x4<f32>` (`h` suffix for f16). Texture/atomic/array/ptr keep their generic form.
- **WGSL vertex entry parameter is named `in`** — `fn vs(in: Vertex) -> VertexOutput`, mirroring `fs`.
- **Comments earn their place.** Only when they add a why, a gotcha, or a non-obvious invariant. No `ponytail:`/agent prefixes in committed comments — keep the content, strip the prefix.
- **Use the lookup skills, don't answer from memory.** WebGPU platform questions → `webgpu-spec-lookup`. `webgpu-utils` library questions → `webgpu-utils-lookup`.

## Shaders

WGSL lives next to its importer, loaded via `?raw`. Cross-example shaders live in `src/modules/pbr/`. Aliases work in `?raw` imports (`@modules/pbr/pbr.wgsl?raw`); keep same-directory imports relative.

Conventions enforced by `webgpu-utils` reflection:

- Render uniform block must be named `uniforms` (lowercase), typed as a struct. `RenderPipeline` reads `this.defs.uniforms.uniforms` directly.
- Entry points: vertex `vs`, fragment `fs`, hardcoded in `RenderPipeline`. Compute entry points can be anything — each becomes a kernel keyed by its name.
- Texture uniforms take a `t<Name>` prefix (`tMap`, `tNormal`, `tBrdf`). Samplers are not textures — descriptive names (`iblSampler`).

`npm run validate:shaders` checks every `**/*.wgsl` with `naga`, no browser needed (single file: `node scripts/validate-shaders.mjs <file>`). Install with `brew install naga-cli` — **not** `brew install naga`, an unrelated Snake game that takes the same binary name.

## Optional features are not guaranteed

`Renderer.initDevice` feature-detects its `wantedFeatures` wishlist and drops (with a warn) anything the adapter lacks, so the engine boots anywhere. Guard any path that needs one on `device.features.has(...)` — `TimingHelper` gates on `'timestamp-query'`, `ComputeShader` timing is opt-in via `timing: true`. Texture-compression families are platform-split (`astc`/`etc2` ≈ mobile/Apple, `bc` ≈ desktop).

## Running examples

`src/main.js` handles two query strings — don't confuse them:

- **`?example=<key>`** — user-facing gallery (sidebar + preview iframe); the iframe loads `./?src=<key>` internally. This is what you link to.
- **`?src=<key>`** — boots that example standalone on the page's own canvas, no gallery chrome.

Keys live in the `views` map, gallery rows in the `links` array below it. New example: class under `examples/<name>/`, import it in `src/main.js`, add both entries.

## Assets and external deps

- `public/assets/` — KTX cubemaps, PBR textures, JSON rigs/animations. Plain `fetch('./assets/...')`.
- `public/libktx_read.js` + `.wasm` — Khronos KTX reader, loaded as a global `<script>` in `index.html`; `initDevice` stashes it on `window.ktx`, ready once `renderer.ready` resolves.
- `wgpu-matrix` — functions mutate the out param (last arg) and return it.
- `webgpu-utils` — reflection, buffer/attribute creation, primitive generators.
- `parse-exr` — EXR loading inside `@utils/IBLUtils`.
- `@utils/wgslOverrides` (`applyOverrideConstants`) — Safari lacks pipeline-overridable constants, so this bakes `override` decls into module-scope `const` literals before compile, resolving default expressions to numeric literals so webgpu-utils' parser doesn't choke.

Recurring trap across areas: destroying/recreating a `Texture` invalidates its views, so any bind group holding them is stale — rebuild against `pipeline.bindGroupLayout(i)`.

Known gap: no first-class image/KTX texture _loader_.
