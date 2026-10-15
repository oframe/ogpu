# gsplat — Gaussian splat renderer + loaders. Signatures: repo-root api-digest.md.

## GaussianSplat (GaussianSplat.js)

Extends `../../core/Mesh.js`, so it rides the normal scene graph and render
queue. It builds its own `Shader` (+ a `UniformBuffer` for `uCount`) and passes
`geometry`, `shader`, `state` and `bindGroups` to `super({...})` — the constructor
still takes `gpu` first, since it owns the sort compute shaders and buffers. The geometry is 4-vertex triangle-strip screen-space corners — position
attributes mean nothing for culling. Bounds are instead set from splat centers
(positions stride-4) padded by 3× the largest per-axis scale, so frustum
culling in `../../core/Camera.js` works correctly; see the `computeBoundingSphere`
call in the constructor.

**`sort(camera)` must be called every frame BEFORE `renderer.render()`.**
It encodes and submits its own `GPUCommandEncoder` unless you pass
`{ encoder }` (then `sortTime` isn't sampled — the timing readback can't map
before your submit). If it runs after `renderer.render()`, the vertex shader
reads the previous frame's order.

Three sort modes (`sortMode` property, hot-swappable):

- `'gpu'` (default) — synchronous in-frame compute. Blocks the frame budget.
- `'cpu'` — 16-bit counting sort in `gsplatsortworker.js`. Async; the render
  uses the last completed order while the worker is busy. Never stale-blocks
  the frame, but order can lag 1–2 frames behind. Worker is spun up lazily on
  the first CPU sort; it receives a structured-clone copy of positions on init
  (the GPU-side typed array stays intact).
- `'sliced'` — time-sliced GPU radix spread over multiple frames. Use
  `sortSliced(camera, dirty)` every frame instead of `sort()`. Publishes
  atomically on completion; the render never sees a half-sorted state.

Two GPU sort algorithms (`sortMethod`, hot-swappable):

- `'radix'` (default) — 4-bit LSD, 8 passes, O(n). Ping-pongs between two
  key/index buffer pairs (A = `keysBuffer`/`indicesBuffer`, B = the `_B`
  pair). 8 passes is even → final scatter lands in the A pair, which the render
  bind group reads via `indicesFrontBuffer`. Don't break that invariant.
- `'bitonic'` — O(n·log²n), one dispatch per (j,k) step. Bind groups are
  pre-baked at init (one per step at 256-byte-aligned offsets in
  `_stepParamsBuffer`). Step count = L(L+1)/2 where L = log2(paddedCount).

All modes publish into `indicesFrontBuffer` — the only buffer the render bind
group reads (binding 5). Work buffers are never visible mid-sort.

Depth keys are **bit-flipped f32 view-space depth** (painter order, back → front).
`paddedCount` is next-power-of-two of `count` — bitonic operates on padded size,
radix on real `count` (computeKeys dispatches only `count` threads on the
radix paths, so the padded tail is keyed only when bitonic runs). Don't
conflate them.

Changing `workgroupSize` via `setWorkgroupSize()` rebuilds both sort
`ComputeShader`s and all their bind groups (WORKGROUP_SIZE is an `override`
constant baked by `applyOverrideConstants` before compile). Any in-flight
sliced sort is abandoned and re-queued. The sort `UniformBuffer` (SortUniforms)
survives the rebuild. Bind groups share resource objects across kernels — one
sort base for computeKeys/bitonicStep, one object per radix pass for
histogram/scan/scatter — and each kernel's layout drops the names it doesn't bind.

Blending: `one / one-minus-src-alpha` (premultiplied); `depthWrite: false`;
`cullMode: 'none'` — all set in the mesh's frozen `state`, which the pipeline
cache keys on (swap `mesh.state` for a new object, never mutate it). If you add a depth-sorted transparent scene, splats must
render in a separate pass — they cannot share a depth-write-enabled render
target because `depthWrite: false` means other objects always composite over
them regardless of depth.

`destroy()` frees every buffer, terminates the CPU-sort worker and
unregisters both sort shaders from hot-reload (`ComputeShader.destroy`). It
does not detach the node — remove it from the scene first. No example ships
in ogpu (no redistributable asset); load any `.ply`/`.splat`/`.spz`/`.sog`
through `loadSplat`.

`sortTime` is an EMA-smoothed millisecond reading: GPU timing via timestamp
queries (guarded on `device.features.has('timestamp-query')`), or
off-thread worker wall time in CPU mode. Same field either way.

## SplatData layout (SplatLoader.js)

All loaders produce the same struct:

```
positions  Float32Array  count×4  [x, y, z, 0]  world-space
colors     Float32Array  count×4  [r, g, b, a]  [0,1]; a = opacity (NOT premultiplied)
rotations  Float32Array  count×4  [x, y, z, w]  unit quaternion
scales     Float32Array  count×4  [sx, sy, sz, 0]  LINEAR world-space std devs
sh         null          higher-order SH parsed but dropped
```

Colors are in **gamma space** (0.5 + SH_C0 × f_dc). Don't apply gamma again
in the shader. Opacity is post-sigmoid where the source format needs it (PLY,
SPZ); `.splat` and SOG ship it already linear.

Scales are always **linear** after loading — exp() is applied during decode for
PLY (log-scale property), SPZ (byte/16 − 10 encoding) and SOG (log-space
codebook, exp'd once at codebook load). Don't exp again.

PLY rotation is stored `[rot_0=w, rot_1=x, rot_2=y, rot_3=z]` — reordered to
`[x,y,z,w]` by the loader. Other formats vary; all normalize before returning.

SPZ v4 uses zstd compression — hard-rejected with an error. Only v1–3 (gzip)
are supported. Version is checked after decompression.

SOG WebP decode: preferred path is WebCodecs `ImageDecoder` (Chrome 94+);
falls back to `createImageBitmap({premultiplyAlpha:'none'})` + 2D canvas.
The canvas fallback exists because some browsers premultiply even with the flag;
if WebP pixel values look wrong, suspect premultiplication on the canvas path.
SOG unbundled (URL ending in `meta.json`) is special-cased in `loadSplat`
before the fetch — the sibling WebP images are fetched relative to the base URL.

Format detection order: URL extension → magic bytes → default `.splat`.
`.splat` has no header; anything unrecognised is assumed to be `.splat`.
