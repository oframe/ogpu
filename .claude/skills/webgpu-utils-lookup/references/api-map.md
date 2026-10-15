# webgpu-utils 2.1.1 — symbol → module map

Every public export and which `dist/2.x/*.d.ts` file defines it. Read the
`.d.ts` for the signature + doc-comment; read `webgpu-utils.module.js` for the
implementation. GitHub source mirrors these names under `src/`.

Base path: `node_modules/webgpu-utils/dist/2.x/`

## data-definitions.d.ts — WGSL reflection & layout derivation

- `makeShaderDataDefinitions(code)` → `defs` (uniforms, storages, structs,
  storageTextures, textures, externalTextures, samplers, `immediates` (new in
  2.x), entryPoints `{ stage, resources }`). OGPU's `reflect()` (src/core/reflect)
  wraps it.
- `makeBindGroupLayoutDescriptors(defs, desc)` — derive
  `GPUBindGroupLayoutDescriptor[]` (sparse by group, entries sorted by binding)
  from a pipeline-descriptor-shaped `desc`: `{ vertex?, fragment?, compute? }`,
  each `{ entryPoint? }` — one entry point per stage. `defs` may also be an
  array (vertex defs first, fragment defs second).

## buffer-views.d.ts — structured writes & typed-array views

Build typed views over ArrayBuffers from a reflected type, write by field name
(WGSL uniform/storage layout rules).

- `makeStructuredView(definition, arrayBuffer?, offset?)` → view with `.set()`,
  `.views`, `.arrayBuffer`.
- `setStructuredView(data, views)` / `setStructuredValues(def, data, buffer, offset?)`
  — write into an existing view/buffer.
- `makeTypedArrayViews(typeDef, arrayBuffer?, offset?)` → `{ views, arrayBuffer }`
  (what OGPU's `StructView` uses; its `set()` is a local copy of
  `setStructuredView`), `setTypedValues(...)`, `setIntrinsicsToView(...)` (global: which intrinsic
  arrays get one view per element instead of one flat view),
  `getSizeAndAlignmentOfUnsizedArrayElement(...)`.

## typed-arrays.d.ts

- `isTypedArray(...)`, `subarray(...)`, `TypedArrayViewGenerator` (class).

## attribute-utils.d.ts — vertex/index buffers & layouts

- `createBuffersAndAttributesFromArrays(device, arrays, options?)` — pack named
  arrays into GPU buffers, returns `{ buffers, bufferLayouts, indexBuffer,
numElements, … }`. `@location` follows declaration order. (OGPU `Geometry`.)
- `createBufferLayoutsFromArrays(arrays, options?)` — just the layout objects.
- `interleaveVertexData(...)`, `setVertexAndIndexBuffers(...)`,
  `drawArrays(...)` — interleaving + draw-helper convenience.
- `makeTypedArrayFromArrayUnion(array, name)`, `getNumComponents(array, name)`.

## texture-utils.d.ts — image → texture, copies, sizing

- `createTextureFromImage(device, url, options?)` — one URL → texture.
- `createTextureFromImages(device, urls[], options?)` — N URLs → layered
  texture; auto-mips with `mips:true`.
- `createTextureFromSource(device, source, options?)` /
  `createTextureFromSources(device, sources[], options?)` — same from decoded
  sources (ImageBitmap/Canvas/Video, or raw data). Options
  (`CreateTextureOptions`): `mips`, `mipLevelCount`, `flipY`,
  `premultipliedAlpha`, `colorSpace`, `format`, `usage`, `size`, `dimension`,
  `textureBindingViewDimension` / `viewDimension` (compat), plus
  `CopyTextureOptions`' `baseArrayLayer`, `mipLevel`. 2.x does no view
  guessing: `textureBindingViewDimension ?? viewDimension` is passed as is, and
  `dimension` goes straight to `createTexture` (else 1d/3d from the view
  dimension, otherwise 2d) — OGPU's wrapper maps Texture's `'cube'` to `'2d'`
  and fills mips whenever `mipLevelCount > 1` (the library: only for `mips: true`).
- `copySourceToTexture` / `copySourcesToTexture` — blit decoded source(s) into
  an existing texture (re-uploads).
- `loadImageBitmap(url, options?)` — fetch + decode to ImageBitmap.
- `getSizeFromSource(source, options)` — pixel dims of a source.
- `getSizeForMipFromTexture(texture, mipLevel)`.

## generate-mipmap.d.ts — mip + view-dimension helpers

- `generateMipmap(device, texture)` — render-based mip chain; picks 2d /
  2d-array / cube sampling from `texture.textureBindingViewDimension` (default
  `'2d-array'`) and renders every mip of every layer separately; no 1d/3d.
  2.x dropped 1.x's third argument.
- `numMipLevels(size, dimension?)` — full mip count for a size.
- `guessTextureBindingViewDimensionForTexture(dimension, layers)` — exported but
  unused internally in 2.x; returns 1d / 3d / 2d-array / 2d (never cube).
- `normalizeGPUExtent3D(size)` — coerce extent to `[w,h,d]`.

## primitives.d.ts — geometry generators (namespace `primitives`)

- Generators (output byte-identical to 1.11.0): `createCubeVertices`,
  `createSphereVertices`, `createPlaneVertices`, `createTorusVertices`,
  `createCylinderVertices`, `createTruncatedConeVertices`, `createDiscVertices`,
  `createXYQuadVertices`, `create3DFVertices` — each → named typed-array attrs
  ready for `createBuffersAndAttributesFromArrays`. The namespace also has
  `deindex`, `generateTriangleNormals` and `TypedArrayWrapper`. OGPU's
  `@core/primitives/vertices.js` re-exports only the first eight generators.

## Internal tables (not importable)

- `format-info.d.ts` — `getTextureFormatInfo(format)` → `{ blockWidth,
blockHeight, bytesPerBlock, unitsPerElement, Type }`, used inside the texture
  helpers.
- `wgsl-types.d.ts` — the intrinsic type/size/alignment tables the reflection
  uses. Read when a struct's computed size/offset is in question.

## Quick recipes

- "What are the options for X and their defaults?" → open the function's
  `.d.ts`, read the `options` type + doc-comment.
- "Does X mutate or copy?" → `grep -n 'function X' webgpu-utils.module.js`.
- "What primitives exist?" → `primitives.d.ts`.
- "What view dimension does a helper-made texture get?" →
  `createTextureFromSources` in `webgpu-utils.module.js` (no guessing in 2.x),
  or the repo source for rationale.
