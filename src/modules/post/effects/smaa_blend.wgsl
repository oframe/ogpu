// SMAA pass 3/3 — neighborhood blending: composite the color buffer through
// the blending weights.

struct Uniforms {
  resolution : vec2f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tWeights : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(in.position, 1.0);
  out.vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let texel = 1.0 / uniforms.resolution;
  let uv = in.vUv;

  var a: vec4f;
  a.x = textureSampleLevel(tWeights, mapSampler, uv + texel * vec2f(1.0, 0.0), 0.0).a; // right
  a.y = textureSampleLevel(tWeights, mapSampler, uv + texel * vec2f(0.0, 1.0), 0.0).g; // bottom
  let here = textureSampleLevel(tWeights, mapSampler, uv, 0.0);
  a.w = here.x; // top (vertical weights in .xy → w = up)
  a.z = here.z; // left

  if (dot(a, vec4f(1.0)) < 1e-5) {
    return textureSampleLevel(tMap, mapSampler, uv, 0.0);
  }

  let horizontal = max(a.x, a.z) > max(a.y, a.w);
  var blendOffset = select(vec4f(0.0, a.y, 0.0, a.w), vec4f(a.x, 0.0, a.z, 0.0), horizontal);
  var blendWeight = select(a.yw, a.xz, horizontal);
  blendWeight /= dot(blendWeight, vec2f(1.0));

  let coord1 = uv + blendOffset.xy * texel;
  let coord2 = uv - blendOffset.zw * texel;

  var col = blendWeight.x * textureSampleLevel(tMap, mapSampler, coord1, 0.0);
  col += blendWeight.y * textureSampleLevel(tMap, mapSampler, coord2, 0.0);
  return col;
}
