override shadowDepthTextureSize: f32 = 2048.0;

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  viewMatrix: mat4x4f,
  normalMatrix : mat3x3f,
}

struct Shadow {
  projectionViewMatrix : mat4x4f
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<uniform> shadowUniforms : Shadow;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var shadowMap: texture_depth_2d;
@group(0) @binding(4) var textureSampler: sampler;
@group(0) @binding(5) var tMap: texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
  @location(2) vWorldPos : vec3f,
  @location(3) vShadowCoord: vec4f
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var out : VertexOutput;

  let worldPos = uniforms.modelMatrix * vec4(v.position, 1.0);
  out.vWorldPos = worldPos.xyz;

  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
  out.vNormal = uniforms.normalMatrix * v.normal;
  out.vUv = v.uv;

  var shadowCoord = shadowUniforms.projectionViewMatrix * worldPos;
  shadowCoord = shadowCoord / shadowCoord.w;
  out.vShadowCoord = vec4f(shadowCoord.xy * vec2(0.5, -0.5) + vec2f(0.5), shadowCoord.z, 1.0);

  return out;
}

fn hash23(p : vec3f) -> vec2f
{
	  var p3 = fract(p * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

fn hash22(p : vec2f) -> vec2f
{
	  var p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {

  var visibility = 0.0;
  let oneOverShadowDepthTextureSize = 1.0 / shadowDepthTextureSize;

  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(vec2(x, y));
      let hash = hash22(in.vShadowCoord.xy * shadowDepthTextureSize + offset) - 0.5;

      visibility += textureSampleCompare(
        shadowMap, shadowSampler,
        in.vShadowCoord.xy + (offset + hash) * oneOverShadowDepthTextureSize, in.vShadowCoord.z - 0.0005
      );
    }
  }
  visibility /= 9.0;

  let tex = textureSample(tMap, textureSampler, in.vUv).rgb;

  let lightPos = vec3f(3.0, 10.0, 3.0);
  var light = max(0.0, dot(normalize(in.vNormal), normalize(lightPos)));
  light *= visibility;

  return vec4f(tex * light, 1.0);
}
