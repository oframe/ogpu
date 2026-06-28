// Skinned mesh + PBR (metallic-roughness + IBL), folded from src/modules/pbr/pbr.wgsl.
// Vertex stage pulls skinned position/normal from the Skin compute storage buffers;
// fragment stage is the stock PBR flow. No vertex tangents -> screen-space normal map.

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
  alphaMode : f32,
  hasNormalMap : f32,
  hasTangents : f32,
  useGeometricNormal : f32,
}

struct SHConstants {
  coefficients : array<vec4f, 9>
}

struct Shadow {
  projectionViewMatrix : mat4x4f,
  lightDirection : vec3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> positionBuffer : array<f32>;
@group(0) @binding(2) var<storage, read> normalBuffer : array<f32>;
@group(0) @binding(3) var tSpecular : texture_cube<f32>;
@group(0) @binding(4) var<uniform> shConstants : SHConstants;
@group(0) @binding(5) var tBrdf : texture_2d<f32>;
@group(0) @binding(6) var iblSampler : sampler;
@group(0) @binding(7) var tMap : texture_2d<f32>;
@group(0) @binding(8) var tMetallicRoughness : texture_2d<f32>;
@group(0) @binding(9) var tNormal : texture_2d<f32>;
@group(0) @binding(10) var tOcclusion : texture_2d<f32>;
@group(0) @binding(11) var tEmissive : texture_2d<f32>;
@group(0) @binding(12) var materialSampler : sampler;
@group(0) @binding(13) var tOpacity : texture_2d<f32>;
@group(0) @binding(14) var<uniform> material : Material;
@group(0) @binding(15) var<uniform> shadowUniforms : Shadow;
@group(0) @binding(16) var shadowSampler : sampler_comparison;
@group(0) @binding(17) var shadowMap : texture_depth_2d;

const PI = 3.14159265358979323846;

override roughnessLevels : f32 = 6.0;
override shadowDepthTextureSize : f32 = 2048.0;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
  @builtin(vertex_index) vertexIndex : u32,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
  @location(2) vWorldPos : vec3f,
  @location(3) vShadowCoord : vec4f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var vsOut : VertexOutput;

  let position = vec3f(
    positionBuffer[in.vertexIndex * 3],
    positionBuffer[in.vertexIndex * 3 + 1],
    positionBuffer[in.vertexIndex * 3 + 2]
  );
  let normal = vec3f(
    normalBuffer[in.vertexIndex * 3],
    normalBuffer[in.vertexIndex * 3 + 1],
    normalBuffer[in.vertexIndex * 3 + 2]
  );

  let worldPos = uniforms.modelMatrix * vec4f(position, 1.0);
  vsOut.vWorldPos = worldPos.xyz;
  vsOut.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
  vsOut.vNormal = normalize(uniforms.normalMatrix * normal);
  vsOut.vUv = in.uv;

  var shadowCoord = shadowUniforms.projectionViewMatrix * worldPos;
  shadowCoord = shadowCoord / shadowCoord.w;
  vsOut.vShadowCoord = vec4f(shadowCoord.xy * vec2f(0.5, -0.5) + vec2f(0.5), shadowCoord.z, 1.0);
  return vsOut;
}

fn hash22(p : vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// 3x3 jittered PCF — matches the floor receiver.
fn shadowVisibility(shadowCoord : vec4f) -> f32 {
  var visibility = 0.0;
  let texel = 1.0 / shadowDepthTextureSize;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(vec2(x, y));
      let hash = hash22(shadowCoord.xy * shadowDepthTextureSize + offset) - 0.5;
      visibility += textureSampleCompare(
        shadowMap, shadowSampler,
        shadowCoord.xy + (offset + hash) * texel, shadowCoord.z - 0.002
      );
    }
  }
  return visibility / 9.0;
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

// Tangent-frame-free normal mapping (Schueler) — no vertex tangents on skinned geometry.
fn perturbNormal(N : vec3f, worldPos : vec3f, uv : vec2f, mapN : vec3f) -> vec3f {
  let dp1 = dpdx(worldPos);
  let dp2 = dpdy(worldPos);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);

  let dp2perp = cross(dp2, N);
  let dp1perp = cross(N, dp1);
  let T = dp2perp * duv1.x + dp1perp * duv2.x;
  let B = dp2perp * duv1.y + dp1perp * duv2.y;

  let invmax = inverseSqrt(max(dot(T, T), dot(B, B)));
  let TBN = mat3x3f(T * invmax, B * invmax, N);
  return normalize(TBN * mapN);
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(tMap, materialSampler, in.vUv) * material.baseColorFactor;

  if (material.alphaMode == 1.0 && baseColor.a < material.alphaCutoff) {
    discard;
  }

  let mr = textureSample(tMetallicRoughness, materialSampler, in.vUv);
  let roughness = clamp(mr.g * material.roughnessFactor, 0.04, 1.0);
  let metallic = mr.b * material.metallicFactor;

  let ao = textureSample(tOcclusion, materialSampler, in.vUv).r;
  let emissive = textureSample(tEmissive, materialSampler, in.vUv).rgb * material.emissiveFactor;

  let geoNormal = normalize(in.vNormal);
  var normal = geoNormal;
  if (material.useGeometricNormal < 0.5 && material.hasNormalMap > 0.5) {
    var mapN = textureSample(tNormal, materialSampler, in.vUv).xyz * 2.0 - 1.0;
    mapN = vec3f(mapN.xy * material.normalScale, mapN.z);
    normal = perturbNormal(geoNormal, in.vWorldPos, in.vUv, mapN);
  }

  let v = normalize(uniforms.cameraPosition - in.vWorldPos);
  let nDotV = max(dot(normal, v), 0.0);

  let albedo = baseColor.rgb;
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let f = specularF(f0, roughness, nDotV);
  let kD = (1.0 - f) * (1.0 - metallic);

  let brdf = textureSample(tBrdf, iblSampler, vec2f(nDotV, roughness)).xy;
  let viewReflect = reflect(-v, normal);

  let shDiffuse = max(evaluateSH(normal, shConstants.coefficients), vec3f(0.0));
  let iblSpecular = getIBLSpecular(f0, viewReflect, roughness * (roughnessLevels - 1.0), brdf);

  var col = (kD * shDiffuse * albedo) + iblSpecular;

  let shadow = shadowVisibility(in.vShadowCoord);
  col *= vec3f(mix(0.75, 1.0, shadow));

  col = mix(col, col * ao, material.occlusionStrength);
  col += emissive;

  col = filmic(col);
  col = pow(col, vec3f(1.0 / 2.2));

  let opacity = textureSample(tOpacity, materialSampler, in.vUv).g;
  return vec4f(col, baseColor.a * opacity);
}
