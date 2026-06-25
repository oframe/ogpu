// PBR metallic-roughness shader (glTF-style materials + IBL).
// Standard Mesh uniforms (projection/view/model/normal matrices, cameraPosition,
// resolution) are written per-draw by Mesh.draw; material factors are set by the
// consumer (GLTFLoader per material, or the pbrshader example via Tweakpane).
// Lighting: prefiltered specular cube + SH irradiance + split-sum BRDF LUT.
//
// Texture uniforms follow the engine convention of a `t<Name>` prefix.

struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  resolution : vec2f,
}

struct Material {
  baseColorFactor : vec4f,
  emissiveFactor : vec3f,
  metallicFactor : f32,
  roughnessFactor : f32,
  normalScale : f32,
  occlusionStrength : f32,
  alphaCutoff : f32,
  alphaMode : f32, // 0 = OPAQUE, 1 = MASK, 2 = BLEND
  hasNormalMap : f32, // 0 = use geometric normal, 1 = sample tNormal
  hasTangents : f32, // 1 = vertex tangents present -> build TBN from them, 0 = screen-space derived
  useGeometricNormal : f32, // 1 = ignore the normal map entirely (last-resort geometric normal)
}

struct SHConstants {
  coefficients: array<vec4f, 9>
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var tSpecular : texture_cube<f32>;
@group(0) @binding(2) var<uniform> shConstants : SHConstants;
@group(0) @binding(3) var tBrdf : texture_2d<f32>;
@group(0) @binding(4) var iblSampler : sampler;
@group(0) @binding(5) var tMap : texture_2d<f32>;
@group(0) @binding(6) var tMetallicRoughness : texture_2d<f32>;
@group(0) @binding(7) var tNormal : texture_2d<f32>;
@group(0) @binding(8) var tOcclusion : texture_2d<f32>;
@group(0) @binding(9) var tEmissive : texture_2d<f32>;
@group(0) @binding(10) var materialSampler : sampler;
// Opacity / alpha map (green channel). Bind a white texture for fully opaque.
@group(0) @binding(11) var tOpacity : texture_2d<f32>;
@group(0) @binding(12) var<uniform> material : Material;

const PI = 3.14159265358979323846;

// Total roughness mip levels in the prefiltered IBL specular cube. roughness in
// [0,1] maps to lod [0, roughnessLevels - 1]. Supplied by the consumer via the
// RenderPipeline `constants` from the IBL build (ibl.mipLevels); default keeps
// the old 6-level (lod*5) behavior when unset.
override roughnessLevels : f32 = 6.0;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
  // glTF tangent: xyz = tangent, w = bitangent sign (+/-1). Zero-filled when the
  // geometry has no tangents (hasTangents = 0 then selects the screen-space path).
  @location(3) tangent : vec4f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
  @location(2) vWorldPos : vec3f,
  @location(3) vTangent : vec4f,
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var vsOut : VertexOutput;
  let worldPos = uniforms.modelMatrix * vec4f(v.position, 1.0);
  vsOut.vWorldPos = worldPos.xyz;
  vsOut.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
  vsOut.vNormal = normalize(uniforms.normalMatrix * v.normal);
  vsOut.vUv = v.uv;
  // tangent rotates with the model; keep w (handedness) for the bitangent.
  let worldTangent = (uniforms.modelMatrix * vec4f(v.tangent.xyz, 0.0)).xyz;
  vsOut.vTangent = vec4f(worldTangent, v.tangent.w);
  return vsOut;
}

fn filmic(x : vec3f) -> vec3f {
  let X = max(vec3f(0.0), x - vec3f(0.004));
  let result = (X * (vec3f(6.2) * X + vec3f(0.5))) /
               (X * (vec3f(6.2) * X + vec3f(1.7)) + vec3f(0.06));
  return pow(result, vec3f(2.2));
}

fn specularF(f0 : vec3f, roughness : f32, vDotH : f32) -> vec3f {
  return f0 + (max(vec3f(1.0 - roughness), f0) - f0) * pow(1.0 - vDotH, 5.0);
}

fn getIBLSpecular(specularColor : vec3f, r : vec3f, roughness : f32, brdf : vec2f) -> vec3f {
  let spec = textureSampleLevel(tSpecular, iblSampler, r, roughness).xyz;
  return spec * (specularColor * brdf.x + brdf.y);
}

fn evaluateSH(normal : vec3f, c : array<vec4f, 9>) -> vec3f {
  return c[0].xyz +
    c[1].xyz * normal.y +
    c[2].xyz * normal.z +
    c[3].xyz * normal.x +
    c[4].xyz * (normal.y * normal.x) +
    c[5].xyz * (normal.y * normal.z) +
    c[6].xyz * (3.0 * normal.z * normal.z - 1.0) +
    c[7].xyz * (normal.x * normal.z) +
    c[8].xyz * (normal.x * normal.x - normal.y * normal.y);
}

// Tangent-frame-free normal mapping (Schüler). Builds a TBN from screen-space
// derivatives of world position and uv, avoiding the need for a tangent attribute.
fn perturbNormal(N : vec3f, worldPos : vec3f, uv : vec2f, mapN : vec3f) -> vec3f {
  let dp1 = dpdx(worldPos);
  let dp2 = dpdy(worldPos);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);

  let dp2perp = cross(dp2, N);
  let dp1perp = cross(N, dp1);
  let T = dp2perp * duv1.x + dp1perp * duv2.x;
  let B = dp2perp * duv1.y + dp1perp * duv2.y;

  // Degenerate-uv guard (constant/zero derivatives -> no tangent frame; keep geo
  // normal). Guards inverseSqrt(0) = inf from contaminating the result via mapN.
  // Disabled: hasNormalMap already skips this path when there is no normal map.
  // Source: Christian Schueler, "Followup: Normal Mapping Without Precomputed
  // Tangents" (2013) - http://www.thetenthplanet.de/archives/1180
  // let det = max(dot(T, T), dot(B, B));
  // if (det <= 0.0) {
  //   return N;
  // }

  let invmax = inverseSqrt(max(dot(T, T), dot(B, B)));
  let TBN = mat3x3f(T * invmax, B * invmax, N);
  return normalize(TBN * mapN);
}

// TBN from a supplied vertex tangent (preferred when the geometry carries one).
// Gram-Schmidt re-orthogonalize the tangent against the interpolated normal, then
// derive the bitangent from the glTF handedness sign (tangent.w).
fn tangentNormal(N : vec3f, tangent : vec4f, mapN : vec3f) -> vec3f {
  let T = normalize(tangent.xyz - N * dot(N, tangent.xyz));
  let B = cross(N, T) * tangent.w;
  let TBN = mat3x3f(T, B, N);
  return normalize(TBN * mapN);
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {

  // base color (sRGB texture sampled to linear) * factor
  let baseColor = textureSample(tMap, materialSampler, in.vUv) * material.baseColorFactor;

  if (material.alphaMode == 1.0 && baseColor.a < material.alphaCutoff) {
    discard;
  }

  let mr = textureSample(tMetallicRoughness, materialSampler, in.vUv);
  let roughness = clamp(mr.g * material.roughnessFactor, 0.04, 1.0);
  let metallic = mr.b * material.metallicFactor;

  let ao = textureSample(tOcclusion, materialSampler, in.vUv).r;
  let emissive = textureSample(tEmissive, materialSampler, in.vUv).rgb * material.emissiveFactor;

  // normal mapping. Branches are on uniforms, so derivatives stay in uniform
  // control flow. Precedence:
  //   useGeometricNormal == 1  -> ignore the map, keep the geometric normal (last resort)
  //   hasNormalMap == 0        -> no map bound, keep the geometric normal
  //   hasTangents == 1         -> TBN from the vertex tangent attribute
  //   else                     -> screen-space derived tangent frame (Schueler)
  let geoNormal = normalize(in.vNormal);
  var normal = geoNormal;
  if (material.useGeometricNormal < 0.5 && material.hasNormalMap > 0.5) {
    var mapN = textureSample(tNormal, materialSampler, in.vUv).xyz * 2.0 - 1.0;
    mapN = vec3f(mapN.xy * material.normalScale, mapN.z);
    if (material.hasTangents > 0.5) {
      normal = tangentNormal(geoNormal, in.vTangent, mapN);
    } else {
      normal = perturbNormal(geoNormal, in.vWorldPos, in.vUv, mapN);
    }
  }

  let v = normalize(uniforms.cameraPosition - in.vWorldPos);
  let nDotV = max(dot(normal, v), 0.0);

  let albedo = baseColor.rgb;
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let f = specularF(f0, roughness, nDotV);
  let kD = (1.0 - f) * (1.0 - metallic);

  let brdf = textureSample(tBrdf, iblSampler, vec2f(nDotV, roughness)).xy;
  let viewReflect = reflect(-v, normal);

  let shDiffuse = max(evaluateSH(normal, shConstants.coefficients), vec3f(0.0, 0.0, 0.0));
  let iblSpecular = getIBLSpecular(f0, viewReflect, roughness * (roughnessLevels - 1.0), brdf);

  // SH irradiance is already scaled by PI
  var col = (kD * shDiffuse * albedo) + iblSpecular;

  col = mix(col, col * ao, material.occlusionStrength);
  col += emissive;

  col = filmic(col);
  col = pow(col, vec3(1.0 / 2.2));

  let opacity = textureSample(tOpacity, materialSampler, in.vUv).g;
  return vec4f(col, baseColor.a * opacity);
}
