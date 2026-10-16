# Folding PBR shading into a custom WGSL shader

Use this when the target shader has its own vertex work (displacement,
instancing, vertex pulling, skinned positions) and only the _lighting_ should
become PBR. The strategy: keep the user's vertex stage, replace/extend the
fragment stage with the PBR flow from `src/modules/pbr/pbr.wgsl`. Always read
the current `pbr.wgsl` first — copy from the file, not from memory.

## 1. Material struct + engine block

`pbr.wgsl` has no per-frame `Uniforms` block. Camera/object data comes from the
engine block `Shader` appends (group 1): the fragment flow reads
`camera.cameraPosition`, and the vertex stage builds world position and world
normal from `object.modelMatrix` / `object.normalMatrix`. Don't declare those in a
`Uniforms` struct, and start the file with
`// validate-prepend: <relative path>/src/core/engine.wgsl` (as `pbr.wgsl` does).
The material factors are a separate `material` uniform owned by the consumer
(`UniformBuffer`, binding 12 in the stock layout); the user's own `Uniforms`
struct (if any) stays untouched.

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
  `constants: { roughnessLevels: ibl.mipLevels }` to the `Shader` so the mapping
  matches the cube you built. Don't hardcode `roughness * 5.0`.

## 6. Engine conventions checklist

- the user's own uniform block (if any) is named `uniforms`; entry points `vs` / `fs`
  (hardcoded)
- per-pass/per-draw fields come from the engine block (`camera.*`, `object.*`,
  `time.*`, group 1), never from the shader's own structs; user resources stay in group 0
  (groups 2–3 for extras)
- WGSL lives next to the JS, imported with `?raw`
- WGSL short aliases (`vec3f`, `mat3x3f`, …); `let` for values that don't change,
  `var` only where reassigned
