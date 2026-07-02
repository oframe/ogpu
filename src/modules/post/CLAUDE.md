# src/modules/post — postprocessing stack

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

## The contract chain

- **Scene shaders opting into post output MRT**: `@location(0)` linear-HDR
  color, `@location(1)` world-space normal (xyz; `.a` free). Shaders that skip
  location(1) still validate — the attachment clears to 0 and AO/SSR treat
  zero-length normals as sky. **No gamma in scene shaders** — `FinalPassEffect`
  owns the linear→sRGB boundary.
- **Scene pipelines must take the composer's depth state**: pass
  `depthStencil: post.depthStencil` (depth32float) to `RenderPipeline`, or the
  pass/pipeline formats mismatch and nothing draws. Same for
  `targets: post.sceneTarget.getTargets()`.
- **`post.enabled = false` bypasses effects, not the pipeline** — the scene
  still renders through `sceneTarget` and the blit passes through 1:1, because
  scene pipelines are compiled against the MRT target.
- **No MSAA through the composer** (sampleCount forced 1): multisampled depth
  can't be resolved for AO/SSR; TAA/SMAA/FXAA replace it.

## Canonical effect order

AO (GTAO|SSAO) → SSR → TAA → DoF → Bloom → FinalPass (grading+tonemap+vignette,
HDR→LDR) → FXAA|SMAA (LDR) → swapchain blit. The composer runs whatever array
you give it — this order is the example's, and the one that makes sense:
TAA after AO/SSR denoises their IGN patterns; AA after tonemap wants
perceptual input.

## FullscreenPass footguns

- **One uniform buffer per pass**: `queue.writeBuffer` lands before submit, so
  per-draw uniform variance within a frame is impossible. Shaders that run
  many times per frame (bloom mip chain) derive per-draw data from
  `textureDimensions(...)` instead. If a pass truly needs different uniform
  values per draw, use two pass instances (see gaussian blur H/V).
- **Keyed bind groups**: `setBindings(bindings, key)` + `draw({ bindKey })` —
  identity-memoized per key. Distinct keys keep several bind sets alive
  (mip chains); reusing one key per frame with alternating views rebuilds the
  group every frame.
- Effects returning `false` from `render()` tell the composer to skip the
  ping-pong swap (frame passes through) — used while SMAA's LUTs load and for
  tier-disabled effects (SSR/TAA at `low`).

## WGSL conventions in this directory

- Every shader is **self-contained** — no include/concat. The naga gate
  (`npm run validate:shaders`) validates files standalone, and ShaderReload
  matches file content; concatenation would break both. Small helpers
  (luminance, sRGB, IGN, depth reconstruction) are duplicated per shader on
  purpose.
- **uv convention**: every post `vs` flips uv.y (`vUv = (uv.x, 1 - uv.y)`),
  putting (0,0) at the texture's top-left — D3D-style y-down, which matches
  WebGPU texture space AND the original SMAA/GTAO conventions. Each pass is
  orientation-preserving; forget the flip and the pass inverts the frame.
- Depth is bound as `texture_depth_2d` and read with `textureLoad` — sampling
  a depth32float view through a filtering sampler fails validation.
- **Space mixing trap**: screen-space marching directions (uv, y-down) flip y
  vs view space (y-up). GTAO's slice basis does `vec3f(omega.x, -omega.y, 0)`
  for exactly this reason.

## Temporal bits

- The composer injects Halton jitter into `camera.projectionMatrix` (elements
  8/9) when an enabled effect has `needsJitter`, and restores it after submit.
  Effects therefore see _jittered_ matrices — consistent with the depth
  buffer. TAA reconstructs its velocity from _unjittered_ matrices by
  subtracting `composer.jitter`.
- TAA velocity is camera-reprojection only (v1): fast-moving objects rely on
  the neighborhood clamp and can leave faint trails (visible in SSR
  reflections of spinning meshes). Per-object motion vectors are the known
  extension.

## Known gaps (deliberate v1 cuts)

- SMAA: no diagonal/corner detection (straight-edge 1x port).
- SSR: no roughness input yet (normal `.a` is reserved for it), no hi-z.
- No per-pass GPU timings — `TimingHelper` wraps single passes and the
  composer batches everything in one encoder; fps/JS-frame monitors in the
  example stand in.
