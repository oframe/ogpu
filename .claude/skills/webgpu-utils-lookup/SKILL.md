---
name: webgpu-utils-lookup
description: Ground any answer about the webgpu-utils library (greggman/webgpu-utils) in its actual API before responding. Use whenever a question or task touches a webgpu-utils function, class, or option — makeShaderDataDefinitions, makeStructuredView, createBuffersAndAttributesFromArrays, createTextureFromImage(s)/Source(s), generateMipmap, primitives.*, setStructuredView, the reflected uniform/storage views, bind-group-layout generation, attribute/buffer creation, mip generation, or anything imported from 'webgpu-utils'. In the OGPU engine this library backs RenderPipeline, ComputeShader, Geometry, Texture, and IBLUtils, so it surfaces constantly — consult it before claiming a signature, option name, default, or behavior, rather than guessing from memory. Trigger even when the user doesn't name the library, if the symbol clearly belongs to it.
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

This codebase pins **webgpu-utils 1.11.0** (`dist/1.x`). The installed copy is
the ground truth for _this_ project — prefer it over anything you recall or find
online, because online docs track latest and may have drifted.

## Lookup order

1. **Local types — authoritative for the installed version.** The `.d.ts` files
   carry full signatures, option-object shapes, defaults, and the doc-comments
   (often with usage examples). Read these first:

    ```
    node_modules/webgpu-utils/dist/1.x/<module>.d.ts
    ```

    `references/api-map.md` maps every exported symbol to its `.d.ts` module so
    you can jump straight to the right file.

2. **Local implementation — when behavior isn't clear from the type alone.**
   Questions like "does it mutate the argument or return a copy?", "what does it
   default the format to?", "how does it decide cube vs 2d-array?" are answered
   by reading the compiled source:

    ```
    node_modules/webgpu-utils/dist/1.x/webgpu-utils.module.js
    ```

    It's readable ES — `grep -n 'function <name>'` to find the definition.

3. **GitHub repo — for rationale, latest source, history, issues.** Use when the
   local copy doesn't settle it, when the user asks about a version newer than
   1.11.0, or when "why does it do this" needs the original TypeScript / commit
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
  from local 1.11.0, flag the gap — the user runs 1.11.0.
- **Respect OGPU's wrappers.** This engine rarely calls webgpu-utils raw; it
  wraps it (`RenderPipeline` → `makeShaderDataDefinitions` + `makeStructuredView`;
  `Geometry` → `createBuffersAndAttributesFromArrays`; `Texture`/`IBLUtils` →
  texture + mip helpers). When a question is really "how do I do X in OGPU",
  check how the wrapper already uses the helper (`src/core/`, `src/utils/`)
  before reaching for the raw call — the convention may already exist. The
  reflection-by-name rules (uniform block named `uniforms`, `vs`/`fs` entry
  points, `t<Name>` texture prefix) are OGPU conventions layered on top of the
  library's name-keyed reflection — see CLAUDE.md.

## The two highest-traffic areas

Most OGPU questions land in one of these; know where they live.

- **WGSL reflection & structured writes** (`data-definitions.d.ts`):
  `makeShaderDataDefinitions(code)` parses WGSL into `defs`;
  `makeStructuredView(def, buffer?)` builds a typed view whose `.set({...})`
  writes by field name into an ArrayBuffer; `setStructuredView`/
  `setStructuredValues` write into an existing view;
  `makeBindGroupLayoutDescriptors` derives layouts. This is how every pipeline's
  uniforms get written — name mismatches fail silently, so verify field names
  against the struct.

- **Geometry / vertex buffers** (`attribute-utils.d.ts`):
  `createBuffersAndAttributesFromArrays` packs arrays into GPU buffers and emits
  `bufferLayouts`; `@location` is assigned by **declaration order** in the input
  object, not by name. Confirm order before trusting a binding.

For the full symbol → module table and the texture/mipmap/primitives groups, see
`references/api-map.md`.
