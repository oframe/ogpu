---
name: pbr-shading
description: Fold PBR/IBL shading into a RenderPipeline in the OGPU engine. Use whenever the user wants physically based shading, IBL, image-based lighting, metallic/roughness materials, an environment-lit mesh, "make this look like a real material", or wants to combine their own custom vertex/fragment work with the engine's PBR lighting. Also use when a mesh has no textures and needs sensible fallback (factor-only) material setup.
---

# Fold PBR shading into a RenderPipeline

The engine has a complete PBR implementation in `src/modules/pbr/pbr.wgsl`
(metallic-roughness + IBL: prefiltered specular cube, SH irradiance, split-sum
BRDF LUT). There is no runtime shader-chunk system — integration means copying
the right WGSL pieces into the target shader and wiring the right JS resources.
This skill tells you which pieces, in what order, and what breaks silently if
you get it wrong.

## Decide the integration shape

1. **Stock shading, standard geometry** → use `@modules/pbr/pbr.wgsl?raw`
   directly as the pipeline `code`. No WGSL editing. Works when the mesh just
   needs to look PBR-lit and the vertex stage is plain MVP transform.
2. **Custom shader keeps its vertex work (displacement, instancing, skinning,
   procedural normals)** → fold the PBR fragment stage into the user's WGSL.
   Read `references/wgsl-folding.md` for exactly which blocks to copy and how
   to splice them.

Either way the JS wiring (IBL resources, fallback textures, bind group) is the
same — `references/js-wiring.md` has the full copy-paste blocks.

## Workflow

1. Read the target pipeline/shader and its geometry. Confirm attribute ORDER —
   webgpu-utils assigns `@location` by declaration order in the `data` object,
   not by name. `pbr.wgsl` expects `position` (loc 0), `normal` (loc 1),
   `uv` (loc 2). A geometry declared `{position, normal, texcoord}` works
   (third attr lands on loc 2 regardless of name); `{position, uv, normal}`
   silently shades garbage.
2. Wire IBL resources (specular cube + SH buffer + BRDF LUT + sampler). Copy
   `initIBL()` from `examples/gltf/GLTF.js` or
   `examples/pbrshader/PBRShader.js` — they are the canonical block.
   `loadIBLCubeMap` returns `mipLevels`; pass it back to the pipeline as
   `constants: { roughnessLevels: ibl.mipLevels }` or the roughness→lod mapping
   is wrong. Default environment assets: `./assets/pbr/artistworkshop_oct.exr`
   (specular env) + `./assets/pbr/artistworkshop_sh.json` (precomputed 9-coeff
   diffuse-irradiance SH, consumed by `loadSphericalHarmonics`).
3. Resolve material textures. For every map the user did NOT provide, bind a
   2×2 solid fallback instead — never leave a binding empty (pipeline creation
   throws) and never branch the shader on "has texture" per-map (the material
   factors already make white/black fallbacks behave as pass-throughs):
    - white → `tMap`, `tMetallicRoughness`, `tOcclusion`, `tOpacity` (sample =
      1.0, so the `*Factor` uniforms fully control the material and opacity stays
      fully opaque)
    - black → `tEmissive` (no emission), `tNormal` (paired with
      `hasNormalMap: 0` so the shader keeps the geometric normal — the normal
      map path uses screen-space derivatives and must not run on garbage data)
4. Set ALL `Material` factors once at init — they live in a _separate_ uniform
   block (binding 12), not the per-frame `Uniforms`, so they aren't written by
   `Mesh.draw`; you own that buffer. webgpu-utils zero-initializes, and a zeroed
   `baseColorFactor` renders black. Defaults that mean "plain mid-grey
   dielectric": see `references/js-wiring.md`.
5. Create the bind group with the device — `RenderPipeline` exposes
   `pipeline.bindGroupLayout(group)` and `pipeline.defs`, but owns no uniform
   buffer or `createBindGroup` helper. With stock `pbr.wgsl` the layout is
   fixed: 0 per-frame `Uniforms` (the Mesh's buffer), 1 specular cube view, 2
   SH buffer, 3 BRDF LUT view, 4 `iblSampler` (linear, mipmap linear, clamp), 5
   `tMap`, 6 `tMetallicRoughness`, 7 `tNormal`, 8 `tOcclusion`, 9 `tEmissive`,
   10 `materialSampler` (linear, repeat), 11 `tOpacity`, 12 `Material` buffer.
6. Verify with `npm run build` (pipeline construction / reflection errors are
   runtime, but build catches JS/import mistakes) and
   `npm run validate:shaders` for folded WGSL. If a dev server check is
   possible, load the example view and check the console for device validation
   errors.

## Things that break silently

- The uniform block must be `var<uniform> uniforms : Uniforms` — reflection
  looks up `defs.uniforms.uniforms` by that exact name.
- `Mesh.draw` writes only the standard per-frame fields that exist in the
  `Uniforms` struct (projection/view/model/normalMatrix/cameraPosition/
  resolution/time, written by name). Keep those field names verbatim. It does
  NOT touch the `Material` block — that buffer is yours: write it once at init,
  and re-`writeBuffer` it yourself when a factor changes (e.g. from a GUI).
- `roughnessLevels` is an `override` constant fed from the IBL build's
  `mipLevels`. Forget `constants: { roughnessLevels: ibl.mipLevels }` and the
  pipeline still builds (default 6.0), but reflections sample the wrong mip
  whenever the cube has a different mip count — silent, not an error.
- Output is tonemapped (filmic) + gamma encoded in the fragment shader. If the
  pipeline renders into an intermediate RenderTarget that later gets its own
  display/post pass, don't gamma-encode twice — drop the `filmic`/`pow` tail
  and do it in the final pass instead.
- When rendering into an MSAA RenderTarget, pass both `targets:
rt.getTargets()` and `sampleCount: rt.sampleCount` to the RenderPipeline.
- `loadIBLCubeMap` is EXR-decode + GGX-prefilter heavy; wrap the promise in
  `renderer.trackCompile(...)` so the boot overlay holds until it settles.

## References

- `references/js-wiring.md` — IBL init (specular cube + SH + BRDF LUT),
  `loadSphericalHarmonics` shape, `roughnessLevels` wiring, fallback textures,
  `Material` buffer + defaults, full 0–12 bind group (copy-paste blocks)
- `references/wgsl-folding.md` — folding the PBR fragment stage into a custom
  shader: the `Uniforms`/`Material`/`SHConstants` blocks, bindings, the normal
  precedence (tangent vs screen-space), functions, fragment flow
- Canonical working examples: `examples/gltf/GLTF.js` (stock pbr.wgsl via
  GLTFLoader), `examples/pbrshader/PBRShader.js` (stock pbr.wgsl,
  hand-wired, fallback textures, swizzled RMO map, debug SH/specular probes)
