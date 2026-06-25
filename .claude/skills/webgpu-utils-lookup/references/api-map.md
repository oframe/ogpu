# webgpu-utils 1.11.0 — symbol → module map

Every public export and which `dist/1.x/*.d.ts` file defines it. Read the
`.d.ts` for the signature + doc-comment; read `webgpu-utils.module.js` for the
implementation. GitHub source mirrors these names under `src/`.

Base path: `node_modules/webgpu-utils/dist/1.x/`

## data-definitions.d.ts — WGSL reflection & structured buffer writes

The reflection core. Parse WGSL, build typed views over ArrayBuffers, write by
field name, derive bind group layouts.

- `makeShaderDataDefinitions(code)` → `defs` (uniforms, storages, structs,
  entryPoints, …). OGPU's `RenderPipeline`/`ComputeShader` start here.
- `makeStructuredView(definition, arrayBuffer?, offset?)` → view with `.set()`,
  `.views`, `.arrayBuffer`. Writes by name; respects std140-ish layout.
- `setStructuredView(data, views)` / `setStructuredValues(def, data, buffer, offset?)`
  — write into an existing view/buffer.
- `makeBindGroupLayoutDescriptors(defs, options)` — derive
  `GPUBindGroupLayoutDescriptor[]` from reflection.

## attribute-utils.d.ts — vertex/index buffers & layouts

- `createBuffersAndAttributesFromArrays(device, arrays, options?)` — pack named
  arrays into GPU buffers, returns `{ buffers, bufferLayouts, indexBuffer,
numElements, … }`. `@location` follows declaration order. (OGPU `Geometry`.)
- `createBufferLayoutsFromArrays(arrays, options?)` — just the layout objects.
- `interleaveVertexData(...)`, `setVertexAndIndexBuffers(...)`,
  `drawArrays(...)` — interleaving + draw-helper convenience.

## texture-utils.d.ts — image → texture, copies, sizing

- `createTextureFromImage(device, url, options?)` — one URL → texture.
- `createTextureFromImages(device, urls[], options?)` — N URLs → layered
  texture (6 → cube when `viewDimension:'cube'`); auto-mips with `mips:true`.
- `createTextureFromSource(device, source, options?)` /
  `createTextureFromSources(device, sources[], options?)` — same from decoded
  sources (ImageBitmap/Canvas/Video). Options (`CreateTextureOptions`): `mips`,
  `mipLevelCount`, `flipY`, `premultipliedAlpha`, `colorSpace`, `viewDimension`,
  plus the `CopyTextureOptions` fields (`format`, `usage`, …). Read the type for
  exact defaults.
- `copySourceToTexture` / `copySourcesToTexture` — blit decoded source(s) into
  an existing texture (re-uploads).
- `loadImageBitmap(url, options?)` — fetch + decode to ImageBitmap.
- `getSizeFromSource(source, options)` — pixel dims of a source.

## generate-mipmap.d.ts — mip + view-dimension helpers

- `generateMipmap(device, texture, viewDimension?)` — render-based mip chain.
- `numMipLevels(size, dimension?)` — full mip count for a size.
- `guessTextureBindingViewDimensionForTexture(dimension, layers)` — how the
  texture helpers decide 2d / 2d-array / cube.
- `normalizeGPUExtent3D(size)` — coerce extent to `[w,h,d]`.

## primitives.d.ts — geometry generators (namespace `primitives`)

- Full set in 1.11.0: `createCubeVertices`, `createSphereVertices`,
  `createPlaneVertices`, `createTorusVertices`, `createCylinderVertices`,
  `createTruncatedConeVertices`, `createDiscVertices`, `createXYQuadVertices`,
  `create3DFVertices` — each → named typed-array attrs ready for
  `createBuffersAndAttributesFromArrays`.

## buffer-views.d.ts / typed-arrays.d.ts — low-level typed arrays

- `makeTypedArrayViews(...)`, `makeTypedArrayFromArrayUnion(...)`,
  `TypedArrayViewGenerator` (class), `subarray(...)`, `setTypedValues(...)`,
  `setIntrinsicsToView(...)`, `isTypedArray(...)`,
  `getSizeAndAlignmentOfUnsizedArrayElement(...)`, `getNumComponents(...)`,
  `getSizeForMipFromTexture(...)`.

## wgsl-types.d.ts — intrinsic WGSL type tables

Type/size/alignment tables the reflection uses. Read when a struct's computed
size/offset is in question.

## Quick recipes

- "What are the options for X and their defaults?" → open the function's
  `.d.ts`, read the `options` type + doc-comment.
- "Does X mutate or copy?" → `grep -n 'function X' webgpu-utils.module.js`.
- "What primitives exist?" → `primitives.d.ts`.
- "Why does the cube helper pick this view?" →
  `guessTextureBindingViewDimensionForTexture` in `generate-mipmap.d.ts` +
  impl, or the repo source for rationale.
