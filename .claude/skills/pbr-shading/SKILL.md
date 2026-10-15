---
name: pbr-shading
description: Fold PBR/IBL shading into a Shader + Mesh in the OGPU engine. Use whenever the user wants physically based shading, IBL, image-based lighting, metallic/roughness materials, an environment-lit mesh, "make this look like a real material", or wants to combine their own custom vertex/fragment work with the engine's PBR lighting. Also use when a mesh has no textures and needs sensible fallback (factor-only) material setup.
---

# Fold PBR shading into a Shader + Mesh

The engine has a complete PBR implementation in `src/modules/pbr/pbr.wgsl`
(metallic-roughness + IBL: prefiltered specular cube, SH irradiance, split-sum
BRDF LUT). There is no runtime shader-chunk system — integration means copying
the right WGSL pieces into the target shader and wiring the right JS resources.
This skill tells you which pieces, in what order, and what breaks silently if
you get it wrong.

## Decide the integration shape

1. **Stock shading, standard geometry** → use `@modules/pbr/pbr.wgsl?raw`
   directly as the `Shader` `code`. No WGSL editing. Works when the mesh just
   needs to look PBR-lit and the vertex stage is plain MVP transform.
2. **Custom shader keeps its vertex work (displacement, instancing, skinning,
   procedural normals)** → fold the PBR fragment stage into the user's WGSL.
   Read `references/wgsl-folding.md` for exactly which blocks to copy and how
   to splice them.

Either way the JS wiring (IBL resources, fallback textures, bind group) is the
same — `references/js-wiring.md` has the full copy-paste blocks.

## Workflow

1. Read the target shader and its geometry. Confirm attribute ORDER —
   `@location` is assigned by declaration order in the geometry's `data` object,
   not by name. `pbr.wgsl` expects `position` (loc 0), `normal` (loc 1),
   `uv` (loc 2). A geometry declared `{position, normal, texcoord}` works
   (third attr lands on loc 2 regardless of name); `{position, uv, normal}`
   silently shades garbage.
2. Wire IBL resources (specular cube + SH buffer + BRDF LUT + sampler). Copy
   `initIBL()` from `examples/gltf/GLTF.js` or
   `examples/pbrshader/PBRShader.js` — they are the canonical block.
   `loadIBLCubeMap` returns `mipLevels`; pass it back to the `Shader` as
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
4. Set ALL `Material` factors once at init — they live in their own uniform
   (`material`, binding 12; `pbr.wgsl` has no `Uniforms` block, the engine's
   `camera`/`object` come from group 1), so you own that `UniformBuffer`. Unset
   fields are zero, and a zeroed `baseColorFactor` renders black. Defaults that
   mean "plain mid-grey dielectric": see `references/js-wiring.md`.
5. Create the bind group with `shader.bindGroupLayout(0).createBindGroup({ name: resource })` — keys
   are the WGSL names. With stock `pbr.wgsl` group 0 is: 1 `tSpecular` (cube
   view), 2 `shConstants` (SH buffer), 3 `tBrdf` (LUT view), 4 `iblSampler`
   (linear, mipmap linear, clamp), 5 `tMap`, 6 `tMetallicRoughness`, 7 `tNormal`,
   8 `tOcclusion`, 9 `tEmissive`, 10 `materialSampler` (linear, repeat), 11
   `tOpacity`, 12 `material`. Binding 0 is unused; group 1 is the engine's.
6. Verify with `npm run build` (pipeline construction / reflection errors are
   runtime, but build catches JS/import mistakes) and
   `npm run validate:shaders` for folded WGSL. If a dev server check is
   possible, load the example view and check the console for device validation
   errors.

## Things that break silently

- A folded shader's own uniforms: `shader.uniforms` finds only the var named
  `uniforms` (others via `shader.defs.uniforms.<name>`); camera/object matrices are NOT in it — read `camera.*` /
  `object.*` (engine block, group 1) and start the file with
  `// validate-prepend: <path>/src/core/engine.wgsl`.
- The engine never touches the `material` buffer — it's yours: `set` it once at
  init (uploads immediately), and `set` again when a factor changes (e.g. from a GUI).
- `roughnessLevels` is an `override` constant fed from the IBL build's
  `mipLevels`. Forget `constants: { roughnessLevels: ibl.mipLevels }` and the
  pipeline still builds (default 6.0), but reflections sample the wrong mip
  whenever the cube has a different mip count — silent, not an error.
- Output is tonemapped (filmic) + gamma encoded in the fragment shader. If the
  pipeline renders into an intermediate RenderTarget that later gets its own
  display/post pass, don't gamma-encode twice — drop the `filmic`/`pow` tail
  and do it in the final pass instead.
- Render targets, MSAA and sample count need no wiring: the renderer derives the
  pipeline from the pass. Blend/depth settings go in the Mesh `state`
  (`{ transparent: true, depthWrite: false }`).
- `loadIBLCubeMap` is EXR-decode + GGX-prefilter heavy; wrap the promise in
  `renderer.trackCompile(...)` so the boot overlay holds until it settles.

## References

- `references/js-wiring.md` — IBL init (specular cube + SH + BRDF LUT),
  `loadSphericalHarmonics` shape, `roughnessLevels` wiring, fallback textures,
  `Material` `UniformBuffer` + defaults, full group-0 bind group (copy-paste blocks)
- `references/wgsl-folding.md` — folding the PBR fragment stage into a custom
  shader: the `Material`/`SHConstants` blocks, bindings, the normal
  precedence (tangent vs screen-space), functions, fragment flow
- Canonical working examples: `examples/gltf/GLTF.js` (stock pbr.wgsl via
  GLTFLoader), `examples/pbrshader/PBRShader.js` (stock pbr.wgsl,
  hand-wired, fallback textures, swizzled RMO map, debug SH/specular probes)
