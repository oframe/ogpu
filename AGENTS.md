# AGENTS.md

This file provides guidance to coding agents (Claude Code, OpenAI Codex, Cursor, Gemini CLI, …) when working with code in this repository. It is the shared source of truth. Codex and Cursor Agent mode read it natively; the other tools bridge to it so nothing is duplicated:

- `CLAUDE.md` — one-line `@AGENTS.md` import (Claude Code).
- `GEMINI.md` — one-line `@AGENTS.md` import (Gemini CLI).
- `.cursor/rules/main.mdc` — always-applied rule referencing `@AGENTS.md` (Cursor Chat/Composer).

## Commands

- `npm install` — install deps
- `npm run dev` — start Vite dev server (default http://localhost:5173)
- `npm run build` — production build
- `npm run preview` — serve built output
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, `eslint.config.js`)
- `npm run format` / `npm run format:check` — Prettier (config under the `"prettier"` key in `package.json`)
- `npm run validate:shaders` — validate every `src/**/*.wgsl` with `naga` (the wgpu WGSL compiler). Install via `brew install naga` (or `cargo install naga-cli`); script exits 2 if absent. Use this to check shader edits without a browser. Single file: `node scripts/validate-shaders.mjs <file>`.

No tests or typechecker configured. ESLint + Prettier are set up (format-on-save in the repo). No TypeScript, though hand-written ambient declarations live in `types/ogpu.d.ts` for anyone consuming/migrating to TS.

## Coding conventions

- **Labels are kebab-case.** Every `label:` string (WebGPU resource debug labels and GUI/tweakpane display text) is lowercase, hyphen-separated; interpolations preserved, e.g. `` `${this.label}-bone-buffer` ``.
- **WGSL `let` vs `var`.** In generated shaders use `let` for values that never change and `var` only where the binding is reassigned — don't default everything to `var`.
- **WGSL short type aliases.** Use the short alias form, not the verbose generic: `vec3f` not `vec3<f32>`, `vec2u`/`vec4i` not `vec2<u32>`/`vec4<i32>`, `mat4x4f` not `mat4x4<f32>` (and the `h` suffix for `f16`). Texture/atomic/array/ptr types keep their generic form — they have no alias.
- **WGSL vertex entry parameter is named `in`.** The vertex stage takes its input struct as `in`, not `v` — `fn vs(in: Vertex) -> VertexOutput` (mirrors `fn fs(in: VertexOutput)`). Reference attributes as `in.position`, `in.uv`, etc.
- **Comments are short, terse, and earn their place.** Write one only when it adds signal the code can't (a why, a gotcha, a non-obvious invariant); skip narration. Don't restate what belongs in a CLAUDE.md.
- **WebGPU / webgpu-utils → use the lookup skills.** Any question or change touching the WebGPU platform uses `webgpu-spec-lookup`; anything touching the `webgpu-utils` library uses `webgpu-utils-lookup`. Don't answer from memory.

## Navigation aids (for agents)

Two generated, checked-in artifacts at the repo root let you navigate without opening every file. Both are static — regenerate after the relevant change.

- **`api-digest.md`** — terse public-surface index: every exported class with its public method signatures, exported functions/consts, and barrel re-exports. **This is the canonical _what_ — read it for any signature, constructor option, or method name instead of opening the file or repeating the API here.** Regenerate with `node scripts/build-api-digest.mjs`.
- **`module-graph.json`** — static import graph: nodes = source files / `?raw` shaders / external packages, edges = imports, each node carries `inDegree`/`outDegree`. The `hubs` array lists the highest-in-degree modules — the structural cores worth reading first (`Geometry`, `BufferUtils`, `math`, `RenderPipeline`, `Transform`…). Trace `edges` to find every importer/importee of a file instead of grepping. Regenerate with `node scripts/build-module-graph.mjs`.

This file is the _why_ (rationale, gotchas, conventions); api-digest is the _what_ (signatures); module-graph is the _who-imports-what_. When they overlap, signatures live in api-digest — keep this file free of method lists.

Both are kept honest by a **drift gate**: `npm run repomap` regenerates both; `npm run repomap:check` regenerates and fails if either differs from the committed copy. A tracked pre-commit hook (`.githooks/pre-commit`, wired via `core.hooksPath` by the `prepare` script on `npm install`) runs the check and blocks any commit that would land a stale digest/graph — so they can be trusted as current. If a commit is blocked, `git add api-digest.md module-graph.json` and recommit.

## Running examples

`src/main.js` switches on a `view=` query string and instantiates a single example class. Examples available:

- `?view=particles` → `Particles`
- `?view=triangle` → `Triangle`
- `?view=rendertargets` → `RenderToTexture`
- `?view=pbrshader` → `PBRShader`
- `?view=skinning` → `Skinning`
- `?view=gltf` → `GLTF`
- (no `view`) → `HelloWebGPU`

To add a new example: drop a class under `examples/<name>/`, import it in `src/main.js`, and add a switch case.

WebGPU requires a recent Chromium-based browser. See "Browser floor" below for the (currently very high) feature requirements.

## Browser floor

`Renderer.initDevice` (`src/core/Renderer.js`) keeps a `wantedFeatures` wishlist and **feature-detects** it: each entry is kept only if `adapter.features.has(...)`, and the filtered result is what's passed to `requestDevice`. Anything the adapter lacks is dropped (and logged via `console.warn`) instead of failing the device request. This means the engine boots on any WebGPU-capable adapter; capable machines (e.g. Chrome Canary with everything enabled) still get the full set unchanged.

Consequences for code you add:

- **Don't assume an optional feature is present.** If a code path needs one, guard on `device.features.has(...)` (e.g. `TimingHelper` gates all timestamp work on `'timestamp-query'`; `ComputeShader` timing is opt-in via `timing: true`). Texture-compression formats (`astc`/`etc2` ≈ mobile/Apple, `bc` ≈ desktop) are platform-split — never assume a given family loads.
- The wishlist still reflects the engine's _ideal_ target; trimming it to your real needs is a fork decision, but no longer required to boot.

## Architecture

Hand-rolled WebGPU engine. Vanilla JS, Vite build, no framework, no TypeScript.

Each source directory carries its own `CLAUDE.md` with that area's footguns — Claude Code auto-loads it when you read/edit files there, so the _why_ arrives next to the code. This root file holds only the **cross-cutting** model + conventions; per-area gotchas live in the nested files; per-symbol signatures live in `api-digest.md`. Don't restate a directory's internals here.

### Directory map

- `src/core/` — engine primitives: Renderer, Transform, Camera, Mesh, RenderPipeline, Geometry, ComputeShader, Texture, RenderTarget, `skin/`, ShaderReload. → **`src/core/CLAUDE.md`**
- `src/math/` — chainable three.js-style wrappers over `wgpu-matrix` (Vec2–4, Quat, Mat3/4, Euler, Color), each a `Float32Array` subclass; alias `@math`. → **`src/math/CLAUDE.md`**
- `src/modules/` — optional higher-level pieces: Orbit, Raycast, GUI, Animation, GLTFLoader, CubeMap, VideoTexture, `pbr/` (shader-only IBL library); alias `@modules`. → **`src/modules/CLAUDE.md`**.
- `src/utils/` — standalone helpers; alias `@utils` (see "Assets and external deps").
- `examples/` — runnable demos (repo root, outside `src/`), switched by `?view=` in `src/main.js` (see "Running examples").

### Cross-cutting model

Two contracts hold across every file — internalize these; per-file traps are in the nested CLAUDE.md files:

- **Pass the `gpu` object, never the raw `device`.** `Renderer.init` augments the canvas context with `.device`/`.presentationFormat`/`.renderer`; that augmented object (`renderer.gpu`) is what every class takes and stores. It's async — `await renderer.ready` before any GPU work (it also bootstraps `window.ktx`).
- **Standard uniforms are written by name.** `Mesh.draw` writes the per-frame uniforms (`projectionMatrix`, `viewMatrix`, `modelMatrix`, `modelViewMatrix`, `objectMatrix`, `normalMatrix`, `cameraPosition`, `cameraQuaternion`, `resolution`, `time`) into the pipeline's uniform buffer via webgpu-utils reflection, matched by struct field name. Any shader bound through a Mesh declares a `Uniforms` struct with the subset it uses; a misnamed field is **silently skipped**, no error. (Per-file details in `src/core/CLAUDE.md`.)

Scene graph, frustum culling, hot-reload (`ShaderReload` globs `src/**/*.wgsl` and rebuilds matching pipelines on edit), and the per-frame queue all live in `src/core/` — read its CLAUDE.md before touching render flow.

### Shaders

WGSL usually lives next to the JS that imports it and is loaded via Vite's `?raw` suffix (shaders shared across examples/modules instead live in `src/modules/pbr/` — see Modules above — and are imported via the `@modules/pbr/*` alias):

```js
import myShader from './my.wgsl?raw';
```

Conventions enforced by reflection (`webgpu-utils`):

- The render uniform block must be named `uniforms` (lowercase) and typed as a struct (commonly `Uniforms`). `RenderPipeline` does `this.defs.uniforms.uniforms` directly.
- Vertex entry point is `vs`, fragment is `fs`. Hardcoded in `RenderPipeline`.
- Compute entry points can be anything — every entry point in the module becomes a kernel keyed by its name.
- Texture uniforms are named with a `t<Name>` prefix (e.g. `tMap`, `tNormal`, `tSpecular`, `tBrdf`). Samplers are not textures and keep descriptive names (`iblSampler`, `materialSampler`).

### Import aliases

`vite.config.js` defines path aliases (mirrored in `jsconfig.json` for editor resolution). Use these for cross-directory imports instead of `../../`:

- `@core/*` → `src/core/*`
- `@math/*` → `src/math/*`
- `@modules/*` → `src/modules/*`
- `@utils/*` → `src/utils/*`
- `@examples/*` → `examples/*`
- `@/*` → `src/*`

Aliases work for `?raw` shader imports too (`import s from '@modules/pbr/pbr.wgsl?raw'`). Keep same-directory imports relative (`./cube.wgsl?raw`).

### Data flow per frame

1. Example's `update` (or `renderer.add(cb)`) calls `renderer.render({scene, camera, target?})`.
2. `Renderer.render` updates camera/scene world matrices, walks the scene via `Transform.traverse`, splits nodes into opaque/transparent/UI buckets, sorts each, and concatenates into `this.renderQueue`.
3. For each node, `node.draw({camera, pass, time})` writes uniforms and issues the draw call.
4. If `target` is passed, render-pass attachments come from that `RenderTarget`'s textures (and MSAA resolve targets if present); otherwise it draws to the swapchain + the renderer's own depth texture.

`Renderer.render` accepts an external `encoder` to chain multiple passes in one submit; if omitted, it creates and submits its own command buffer.

### Assets and external deps

- `public/assets/` — KTX cubemaps, PBR textures, JSON rigs/animations for skinning, etc. Referenced via plain `fetch('./assets/...')`.
- `public/libktx_read.js` + `libktx_read.wasm` — Khronos KTX reader, loaded as a global `<script>` in `index.html`. `Renderer.initDevice` calls `window.createKtxReadModule(...)` and stashes the result on `window.ktx`. Anything that consumes KTX assumes `window.ktx` is ready after `renderer.ready` resolves.
- `wgpu-matrix` — all matrix/vector math. Functions mutate the out param (last arg) and return it.
- `webgpu-utils` — shader reflection, buffer/attribute creation, primitive generators (`primitives.createCubeVertices()` etc).
- `parse-exr` — used by `src/utils/IBLUtils/IBLUtils.js` to load EXR environment maps; `IBLUtils` also builds IBL cubemaps (GGX prefilter + octahedral/equirect unpack, shaders co-located in `src/utils/IBLUtils/`) — `loadIBLCubeMap(gpu, {...})` is the entry point; its result carries `mipLevels`, which `pbr.wgsl` consumers feed back as the `roughnessLevels` override constant.

`src/utils/` holds standalone helpers reached via the `@utils/*` alias (signatures in api-digest): `BufferUtils`, `IBLUtils`, `ktxutils`, `Mat3Utils`/`Mat4Utils`/`EulerUtils`, `TimingHelper`, `JSONLoader`, `miscutils`/`utils`. The one worth knowing the _why_ of: `wgslOverrides` (`applyOverrideConstants`) — Safari lacks pipeline-overridable constants, so this bakes `override` decls into module-scope `const` literals before compile, resolving default expressions that reference earlier overrides/consts to numeric literals so webgpu-utils' parser doesn't choke.

### Notes when adding code

- The cross-cutting traps (`gpu` object, uniforms-by-name) are above; the rest live in the per-directory CLAUDE.md files. The recurring one: destroying/recreating a `Texture` (e.g. on resize) invalidates its views, so any bind group holding them is stale — call `updateBindgroup` (see `src/core/CLAUDE.md`).
- Remaining gap: no first-class image/KTX texture _loader_. Storage-buffer helpers (`@utils/BufferUtils`), JSON (`@utils/JSONLoader`), glTF (`GLTFLoader.js`), and IBL cubemaps (`@utils/IBLUtils`) are all implemented.
