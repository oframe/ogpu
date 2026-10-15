---
name: webgpu-utils-lookup
description: Ground any answer about the webgpu-utils library (greggman/webgpu-utils) in its actual API before responding. Use whenever a question or task touches a webgpu-utils function, class, or option — makeShaderDataDefinitions, makeStructuredView, createBuffersAndAttributesFromArrays, createTextureFromImage(s)/Source(s), generateMipmap, primitives.*, setStructuredView, the reflected uniform/storage views, bind-group-layout generation, attribute/buffer creation, mip generation, or anything imported from 'webgpu-utils'. In the OGPU engine this library backs src/core/reflect (Shader, RenderPipeline, ComputeShader, UniformBuffer), Geometry, the primitives, Texture, mipmap and IBLUtils, so it surfaces constantly — consult it before claiming a signature, option name, default, or behavior, rather than guessing from memory. Trigger even when the user doesn't name the library, if the symbol clearly belongs to it.
---

# Answer webgpu-utils questions from the source, not from memory

webgpu-utils is small but full of non-obvious behavior: functions that mutate a
passed-in view in place, reflection that keys uniforms by declared name, helpers
that silently pick a texture view dimension for you, options whose defaults
matter (`mips`, `usage`, `viewDimension`). Memory of "roughly how it works" is
exactly where wrong answers come from — a misremembered option name or a stale
signature compiles fine and then breaks at runtime with no error. The cost of
checking is a few seconds; the cost of guessing is a silent garbage texture or a
buffer written to the wrong offset. So check first.

This codebase pins **webgpu-utils 2.1.1** exactly (`dist/2.x`; its parser,
a bundled `wgsl_reflect` snapshot, is part of the contract). The installed copy
is the ground truth for _this_ project — prefer it over anything you recall or find
online, because online docs track latest and may have drifted.

## Lookup order

1. **Local types — authoritative for the installed version.** The `.d.ts` files
   carry full signatures, option-object shapes, defaults, and the doc-comments
   (often with usage examples). Read these first:

    ```
    node_modules/webgpu-utils/dist/2.x/<module>.d.ts
    ```

    `references/api-map.md` maps every exported symbol to its `.d.ts` module so
    you can jump straight to the right file.

2. **Local implementation — when behavior isn't clear from the type alone.**
   Questions like "does it mutate the argument or return a copy?", "what does it
   default the format to?", "how does it decide cube vs 2d-array?" are answered
   by reading the compiled source:

    ```
    node_modules/webgpu-utils/dist/2.x/webgpu-utils.module.js
    ```

    It's readable ES — `grep -n 'function <name>'` to find the definition.

3. **GitHub repo — for rationale, latest source, history, issues.** Use when the
   local copy doesn't settle it, when the user asks about a version newer than
   2.1.1, or when "why does it do this" needs the original TypeScript / commit
   context: <https://github.com/greggman/webgpu-utils> (source under `src/`,
   one file per module mirroring the `.d.ts` names). Fetch with WebFetch.

4. **Typedoc site — human-readable index / cross-links.** Good for browsing the
   API surface or linking the user somewhere:
   <https://greggman.github.io/webgpu-utils/docs/>. Fetch with WebFetch.

You do not need to walk all four every time. Stop at the first level that
answers the question authoritatively — for a signature, level 1 alone is usually
enough; reach for the repo/site only when local source can't answer it (design
intent, newer versions, changelog).

## How to apply what you find

- **Quote the real thing.** When you state a signature, option, or default, make
  it match the `.d.ts` you just read — exact option names, exact defaults. If you
  paraphrase, say so.
- **Mind the version.** If you cite the GitHub/typedoc surface and it differs
  from local 2.1.1, flag the gap — the user runs 2.1.1.
- **Respect OGPU's wrappers.** Engine code rarely calls webgpu-utils raw; thin
  wrappers keep OGPU's API (the `gpu` object, `StructView`, group skipping):
    - `src/core/reflect` — `reflect(code)` = `makeShaderDataDefinitions` plus
      `inputs` (@location params) on each entry point and two parser shims
      (below); `StructView`/`makeStructuredView` = `makeTypedArrayViews` + a
      local `setStructuredView` with the library's semantics (StructView.js;
      the library's measured 1.9× slower), so debug `set()` there, not in the
      library; `bindGroupLayoutDescriptors(defs, names, { skip })` =
      `makeBindGroupLayoutDescriptors` minus skipped groups. Shader,
      RenderPipeline, ComputeShader and UniformBuffer go through it.
    - `Geometry` → `createBuffersAndAttributesFromArrays`;
      `@core/primitives/vertices.js` → `primitives`, but only the 8 generators
      the primitive classes use (no `create3DFVertices`, `deindex`, …): import
      anything else straight from `'webgpu-utils'`.
    - `@utils/textureFromSource` / `@utils/mipmap` → the texture and mip helpers,
      taking `gpu` instead of `device` (Texture, IBLUtils); Texture's `'cube'`
      becomes a 2d texture and mips fill whenever `mipLevelCount > 1`.

    When a question is really "how do I do X in OGPU", check the wrapper
    (`src/core/`, `src/utils/`) before reaching for the raw call. The
    reflection-by-name rules (uniform block named `uniforms`, `vs`/`fs` entry
    points, `t<Name>` texture prefix) are OGPU conventions layered on top of the
    library's name-keyed reflection — see AGENTS.md.

## Parser behaviour in 2.1.1 (verified against OGPU's shader corpus)

- Bindings read only inside `switch`-case bodies or helper functions ARE in the
  derived layouts (1.x dropped switch-case-only ones). A binding read only in a
  `switch` selector expression is still dropped (wgsl_reflect 1.6 too) — read it
  into a `let` first.
- It rejects `block` as a variable/function identifier (a struct member named
  `block` parses; elsewhere "Expected ';' after statement", "Expected assignment
  operator" or "Expected function name") and can't fold a typed integer const with an expression initialiser
  (`const M: u32 = (1u << 19u) - 1u;` → "Invalid cast from f32 to u32"; the
  untyped form folds). OGPU's `reflect()` bridges both on a parse-only copy, so
  only a raw `makeShaderDataDefinitions` call hits them.
- Struct views: f16 scalars are `Uint16Array` (raw bits), f16 vectors/matrices
  `Float16Array` (values) — the module references `Float16Array` at load.

## The two highest-traffic areas

Most OGPU questions land in one of these; know where they live.

- **WGSL reflection & structured writes** (`data-definitions.d.ts` +
  `buffer-views.d.ts`):
  `makeShaderDataDefinitions(code)` parses WGSL into `defs`;
  `makeStructuredView(def, buffer?)` builds a typed view whose `.set({...})`
  writes by field name into an ArrayBuffer; `setStructuredView`/
  `setStructuredValues` write into an existing view;
  `makeBindGroupLayoutDescriptors` derives layouts. OGPU's `UniformBuffer.set` /
  `StructView.set` write this way (the engine's group(1) does not — it goes
  through PerDrawBuffer): unknown keys are ignored silently, so verify field
  names against the struct.

- **Geometry / vertex buffers** (`attribute-utils.d.ts`):
  `createBuffersAndAttributesFromArrays` packs arrays into GPU buffers and emits
  `bufferLayouts`; `@location` is assigned by **declaration order** in the input
  object, not by name. Confirm order before trusting a binding.

For the full symbol → module table and the texture/mipmap/primitives groups, see
`references/api-map.md`.
