// Shadow-receiving ground plane. Matte directional-lit floor whose direct light
// is gated by the shadow map (PCF), so the skinned character drops a soft
// contact shadow onto it.

override shadowDepthTextureSize : f32 = 2048.0;

struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
}

struct Shadow {
  projectionViewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<uniform> shadowUniforms : Shadow;
@group(0) @binding(2) var shadowSampler : sampler_comparison;
@group(0) @binding(3) var shadowMap : texture_depth_2d;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vShadowCoord : vec4f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  let worldPos = uniforms.modelMatrix * vec4f(in.position, 1.0);
  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;

  var shadowCoord = shadowUniforms.projectionViewMatrix * worldPos;
  shadowCoord = shadowCoord / shadowCoord.w;
  out.vShadowCoord = vec4f(shadowCoord.xy * vec2f(0.5, -0.5) + vec2f(0.5), shadowCoord.z, 1.0);
  return out;
}

fn hash22(p : vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// 3x3 jittered PCF — matches examples/shadowmapping.
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

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  let shadow = shadowVisibility(in.vShadowCoord);
  let light = mix(0.75, 1.0, shadow);
  return vec4f(vec3f(light), 1.0);
}
