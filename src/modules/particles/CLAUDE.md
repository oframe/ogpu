# src/modules/particles — GPU-resident particle system

Signatures in repo-root `api-digest.md`. This file is the atomic choreography +
footguns. The sim is Gareth Thomas GDC14-style: dead list + double-buffered
alive index lists + indirect draw/dispatch, zero CPU readback in the frame loop.

## Kernel order per frame (particles_sim.wgsl)

`beginFrame → emit → writeSimArgs → [gridClear → gridBuild →] simulate|simulateBoids`

All dispatches share one compute pass; within a pass dispatches are implicitly
ordered, so each kernel sees the previous kernel's storage writes.

## Atomic choreography invariants — the classic bug farm

Violating any of these silently corrupts the pool (duplicate live indices,
dead-list underflow, ghost particles). In order:

1. **`beginFrame` clamps before `emit` pops.** `realEmitCount =
   min(requestedEmit, deadCount)` runs in a single-thread kernel *before* any
   `emit` thread executes. That clamp is the only thing making emit's
   `atomicSub(&deadCount, 1) - 1` underflow-free — emit threads guard on
   `id < realEmitCount`, never on `deadCount` itself.
2. **`aliveCountIn` is promoted, not accumulated.** `beginFrame` copies last
   frame's `aliveCountOut` into `aliveCountIn` and zeroes `aliveCountOut` +
   `drawArgs.instanceCount`. The in-list *contents* need no copy: parity swap
   means this frame's in-buffer IS last frame's out-buffer.
3. **`emit` appends to aliveIn** (`atomicAdd(&aliveCountIn)`) so newborns
   simulate the same frame — which is why `writeSimArgs` must run *after*
   emit: it converts the post-emit `aliveCountIn` into the indirect dispatch
   size.
4. **A particle index lives in exactly one list.** `simulate` either pushes the
   index back to the dead list (expired) *or* appends it to aliveOut +
   bumps `instanceCount` — never both, never neither. `life < 0` means
   immortal (never expires).
5. **Counters are all `atomic<u32>`.** Single-thread kernels use
   atomicLoad/Store; sharing one struct across kernels with mixed
   atomic/non-atomic views would need duplicate binding declarations — not
   worth it.

Frame parity: parity `p` reads `aliveBuffers[p]`, writes `aliveBuffers[1-p]`;
the render bind group for frame `p` reads `aliveBuffers[1-p]` (the out list).
All bind-group variants are prebuilt; `update()` just swaps
`this.bindGroups[0]` (same pattern as examples/particles).

## Indirect draw/dispatch

- `drawBuffer` is **5 u32s** (`drawIndexedIndirect`) because the Quad is
  indexed — a 4-field `drawIndirect` layout here draws garbage.
  `indexCount` is written once from the CPU; only `instanceCount` changes.
- `createStorageBuffer` defaults lack `INDIRECT` — both the draw-args and the
  sim-dispatch buffer pass explicit usage.
- `ComputeShader.dispatch` still requires a truthy `dispatchCount` even when
  `workgroupBuffer` drives the size — pass `[1, 1, 1]`.

## Boids grid (v1)

Fixed 32³ uniform grid, `CELL_CAP = 8` indices per cell, neighbor reads capped
at 64. `gridBuild` overflow behavior: the per-cell counter keeps counting past
capacity but overflow writes are dropped — overflowing particles still
simulate and render, they're just invisible as *neighbors*. Positions outside
the grid clamp to edge cells (edge cells get crowded, not wrong). Cell size =
`max(extent/32, neighborRadius)` so the 27-cell neighborhood always covers the
query radius. Mode switch is JS-side: `mode: 'boids'` dispatches
`gridClear/gridBuild/simulateBoids` instead of `simulate` — same buffers.

## Other traps

- Indirect geometry is never auto-culled (`geometry.instanced` is true when a
  `drawBuffer` exists) — the constructor sets explicit `geometry.bounds`;
  pass `bounds: { center, radius }` if the default (radius 1000 ≈ never cull)
  is too loose.
- Blending swap = pipeline swap between two prebuilt `RenderPipeline`s (same
  WGSL). Bind groups stay valid (group-equivalent layouts); `Mesh.draw`
  rebuilds the uniform view on defs change, preserving values.
- The wrap volume (`wrap: { enabled, center, size }`) re-tiles positions in
  `integrate()` — it's a particles feature, rain merely enables it and drives
  `wrap.center` from the camera.
- `hash33`/`curlNoise` are copied verbatim from `examples/particles/sim.wgsl`
  (fitted 24-mode divergence-free field) — don't "improve" the constants.
- Debug counter readback (`debugCounters`) only runs on own-encoder frames so
  `mapAsync` always follows the submit containing the copy.
