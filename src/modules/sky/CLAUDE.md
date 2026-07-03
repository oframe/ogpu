# src/modules/sky — dynamic sky + sun (+ dynamic IBL feed)

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

`Sky.js` owns four co-located shaders: `transmittance_lut.wgsl` (256×64 compute,
Bruneton parametrization), `skyview_lut.wgsl` (192×108 compute — `main` LUT gen
+ `cubeFaces` env-cube writer in one module), `sh_project.wgsl` (runtime SH),
`sky.wgsl` (fullscreen background). Presets in `presets.js`. The dynamic-IBL
plumbing (`createDynamicIBL`) lives in `@utils/IBLUtils` — Sky drives it.

## The update model — dirty flags, not per-frame recompute

- **Nothing recomputes unless dirty.** `_atmosphereDirty` → transmittance LUT
  (turbidity/atmosphere change only), `_skyDirty` → sky-view LUT (sun move,
  mode, palette, grading), env work → cube faces + amortized prefilter + SH.
  A static sun costs zero compute per frame.
- **Both modes + grading live in the sky-view LUT.** Physical vs artistic is a
  uniform branch inside `skyview_lut.wgsl` `main` (no pipeline permutation),
  and the grading layer is baked into the LUT texels. Consumers (`sky.wgsl`,
  `cubeFaces`) sample *finished* radiance and only add the sun disk. Changing
  any grade/palette knob therefore needs `_skyDirty`, not just a uniform write.
- **LUT u axis is |relative azimuth| ∈ [0, π]** — the sky is mirror-symmetric
  about the sun azimuth, so half the sphere is stored and clamp sampling is
  seam-free. The v axis is the Hillaire sqrt-elevation mapping; encode/decode
  exist in three places (`main`, `cubeFaces`, `sky.wgsl`) and must stay in sync.

## Background mesh

- Drawn at the far plane: `depthCompare: 'less-equal'`, no depth write,
  `renderOrder: 1000` (after opaques → early-z kills covered pixels),
  `frustumCulled: false`. View ray is rebuilt from `projectionMatrix[0][0]`/
  `[1][1]` + transposed `viewMatrix` rotation — standard uniforms only, no
  inverse matrices. Perspective cameras only.
- **Post vs plain path**: with a composer, the pipeline takes
  `post.sceneTarget.getTargets()` + depth32float and outputs the MRT contract
  (normal loc1 = vec4f(0) marks sky for AO/SSR); without one, Sky.js strips the
  lines tagged `// mrt` from `sky.wgsl` and the shader applies filmic+gamma
  itself (`applyGamma` uniform). Don't remove the `// mrt` tags — they're load-
  bearing.
- `sky.wgsl` uses `textureSampleLevel`, not `textureSample`: the azimuth-wrap
  uv discontinuity would otherwise pick a huge mip and draw a seam.

## SH projection (`sh_project.wgsl`)

- **Coefficient layout is a contract** with `pbr.wgsl` `evaluateSH` and
  `loadSphericalHarmonics`: 9 × vec4f, order L00, L1-1, L10, L11, L2-2, L2-1,
  L20, L21, L22, raw-polynomial evaluation. Verified numerically against
  `artistworkshop_sh.json` (all 27 values ≤0.2% off after folding the JSON's
  band window ×0.9606/×0.8543 into the scales). The JSON's z-odd terms are
  sign-flipped vs engine cube space (its offline generator used opposite
  z-handedness) — the runtime projection deliberately stays in engine cube
  space so diffuse SH and the prefiltered specular cube agree.
- Single 256-thread workgroup; the tree reduction folds one coefficient at a
  time through a 256×vec3f shared array (4 KB — 9 at once would blow the 16 KB
  workgroup-storage floor).
- Reads the source cube through a `2d-array` view (`textureLoad` can't take
  `texture_cube`), at the ≤64² mip of the source pyramid.
- Results land in a storage buffer, then `copyBufferToBuffer` into
  `ibl.shBuffer` (uniform) — storage and uniform usage can't share one buffer
  cheaply across the existing pbr bind-group layout.

## Sun / IBL feed

- `sky.sunDirection` / `sky.sunColor` are live `Vec3`s for directional/shadow
  consumers. Sun color comes from a 32-step CPU transmittance march using the
  *same* coefficients as the GPU — keep `RAYLEIGH`/`MIE_*`/`OZONE`/radii in
  Sky.js and the WGSL constants in lockstep.
- The sun disk is baked into the env cube (`cubeFaces`) so the GGX prefilter
  produces real sun speculars; `sunDiskIntensity` is the knob that trades
  highlight punch vs bloom blowout.
- Amortization: a sky change marks all prefilter slices pending; each update
  runs `iblBudget` slices (round-robin, via `createDynamicIBL`) every
  `iblInterval` frames. SH reprojects every env update (single tiny dispatch).
  `refreshEnvironment()` is the full burst — used at boot and on scrub-end
  (`ev.last` in the GUI).
- `generateMipmap` on the source cube submits its own command buffer, so the
  update is split into (LUT/faces encoder) → mipgen → (prefilter/SH encoder);
  queue order keeps them correct.
