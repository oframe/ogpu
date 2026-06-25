# Folding PBR shading into a custom WGSL shader

Use this when the target shader has its own vertex work (displacement,
instancing, vertex pulling, skinned positions) and only the _lighting_ should
become PBR. The strategy: keep the user's vertex stage, replace/extend the
fragment stage with the PBR flow from `src/modules/pbr/pbr.wgsl`. Always read
the current `pbr.wgsl` first — copy from the file, not from memory.

## 1. Two uniform blocks: Uniforms and Material

`pbr.wgsl` keeps per-frame data and material factors in _separate_ uniform
blocks, and this split matters: `Mesh.draw` writes only the per-frame
`Uniforms` block by field name each draw, while the `Material` block is owned
and updated by the consumer. Don't merge material factors into `Uniforms` — bind
`Material` as its own buffer (binding 12 in stock layout).

The per-frame `Uniforms` block the fragment flow needs (keep the user's own
fields alongside these — both `Mesh.draw` and reflection match by name):

```wgsl
struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  resolution : vec2f,
}
```

The material factor block (set by the consumer, see `js-wiring.md`):

```wgsl
struct Material {
  baseColorFactor : vec4f,
  emissiveFactor : vec3f,
  metallicFactor : f32,
  roughnessFactor : f32,
  normalScale : f32,
  occlusionStrength : f32,
  alphaCutoff : f32,
  alphaMode : f32,           // 0 OPAQUE, 1 MASK, 2 BLEND
  hasNormalMap : f32,        // 0 = geometric normal, 1 = sample tNormal
  hasTangents : f32,         // 1 = build TBN from vertex tangent, 0 = screen-space
  useGeometricNormal : f32,  // 1 = ignore the normal map entirely
}

struct SHConstants {
  coefficients: array<vec4f, 9>
}
```

## 2. Bindings

Append after the user's existing bindings — numbers are free, reflection finds
them by name. Keep the `t<Name>` texture-prefix convention. This is the full
stock set; bindings 11 (`tOpacity`) and 12 (`material`) are easy to forget and
an incomplete bind-group layout makes pipeline creation throw:

```wgsl
@group(0) @binding(N+0)  var tSpecular : texture_cube<f32>;
@group(0) @binding(N+1)  var<uniform> shConstants : SHConstants;
@group(0) @binding(N+2)  var tBrdf : texture_2d<f32>;
@group(0) @binding(N+3)  var iblSampler : sampler;
@group(0) @binding(N+4)  var tMap : texture_2d<f32>;
@group(0) @binding(N+5)  var tMetallicRoughness : texture_2d<f32>;
@group(0) @binding(N+6)  var tNormal : texture_2d<f32>;
@group(0) @binding(N+7)  var tOcclusion : texture_2d<f32>;
@group(0) @binding(N+8)  var tEmissive : texture_2d<f32>;
@group(0) @binding(N+9)  var materialSampler : sampler;
@group(0) @binding(N+10) var tOpacity : texture_2d<f32>;
@group(0) @binding(N+11) var<uniform> material : Material;
```

If the surface is untextured (pure factor-driven), the material textures can be
dropped entirely — then in the fragment flow replace their samples with
constants (`baseColor = material.baseColorFactor`, `mr = vec4f(0, 1, 1, 0)` i.e.
factor-driven, `ao = 1.0`, `emissive = material.emissiveFactor`, opacity = 1.0,
skip the normal-map branch). That removes the need for fallback textures at the
cost of a less swappable material. Prefer keeping the textures + fallbacks when
the user might add maps later.

## 3. Functions to copy verbatim from pbr.wgsl

- `filmic` (tonemap — omit if a later pass tonemaps)
- `specularF`
- `getIBLSpecular`
- `evaluateSH` (diffuse irradiance from the 9 SH coefficients + surface normal)
- `tangentNormal` (TBN from a vertex tangent — needed for the `hasTangents` path)
- `perturbNormal` (screen-space TBN — the no-tangent fallback; omit only if no
  normal map will ever be bound)
- `const PI`

## 4. Vertex outputs the fragment flow needs

```wgsl
@location(a) vUv : vec2f,        // material map sampling
@location(b) vNormal : vec3f,    // world-space normal (normalMatrix * normal)
@location(c) vWorldPos : vec3f,  // world-space position
@location(d) vTangent : vec4f,   // world tangent.xyz + handedness .w (if using tangents)
```

`vTangent` is only needed for the `hasTangents` path; the vertex stage builds it
as `(modelMatrix * vec4f(tangent.xyz, 0)).xyz` with `tangent.w` carried through
for the bitangent sign. If the geometry has no tangents, zero-fill the
`@location(3) tangent : vec4f` attribute and set `hasTangents: 0` — the shader
then takes the screen-space `perturbNormal` path.

If the vertex stage displaces positions, `vWorldPos` must be the DISPLACED world
position, and the normal should be the displaced surface normal if available
(recomputed analytically or via neighbors); the lighting is only as correct as
the normal.

## 5. Fragment flow

Copy the body of `fs` from `pbr.wgsl` (sampling → alpha test → mr/ao/emissive →
normal mapping → fresnel/IBL evaluation → SH diffuse + IBL specular → occlusion
→ emissive → tonemap → opacity). The normal-mapping branch has a defined
precedence worth preserving:

- `useGeometricNormal == 1` → ignore the map, keep the geometric normal
- `hasNormalMap == 0` → no map bound, keep the geometric normal
- `hasTangents == 1` → `tangentNormal` (TBN from the vertex tangent)
- else → `perturbNormal` (screen-space derived frame, Schüler)

Splice user-specific color work in one of two places:

- **albedo modulation** (procedural color, vertex color): multiply into
  `baseColor` before the lighting math — keeps it physically plausible.
- **post-lighting effects** (fog, rim glow, debug overlays): after `col` is
  assembled, before `filmic`.

Two correctness constraints worth knowing the reason for:

- `textureSample` + `dpdx/dpdy` (inside `perturbNormal`) require uniform control
  flow — don't move them behind non-uniform branches. The `hasNormalMap` /
  `hasTangents` / `useGeometricNormal` branches are fine because they're
  uniforms.
- The IBL specular sample maps roughness onto the prefiltered cube's mip chain
  via `roughness * (roughnessLevels - 1.0)`. `roughnessLevels` is an `override`
  constant (default 6.0) fed from the IBL build's `mipLevels`; pass
  `constants: { roughnessLevels: ibl.mipLevels }` to the pipeline so the mapping
  matches the cube you built. Don't hardcode `roughness * 5.0`.

## 6. Engine conventions checklist

- uniform block named `uniforms`, entry points `vs` / `fs` (hardcoded in
  RenderPipeline)
- standard per-frame fields (`projectionMatrix`, `viewMatrix`, `modelMatrix`,
  `normalMatrix`, `cameraPosition`, `resolution`, `time`) are written by
  `Mesh.draw` only if present in the struct — declare what you use
- WGSL lives next to the JS, imported with `?raw`
- WGSL short aliases (`vec3f`, `mat3x3f`, …); `let` for values that don't change,
  `var` only where reassigned
