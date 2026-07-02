// Bloom composite: scene + accumulated bloom * tint * intensity. Stays in
// linear HDR — tonemap comes later in the chain.

struct Uniforms {
  intensity : f32,
  tint : vec3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tBloom : texture_2d<f32>;

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
  let src = textureSample(tMap, mapSampler, in.vUv);
  let bloom = textureSample(tBloom, mapSampler, in.vUv).rgb;
  return vec4f(src.rgb + bloom * uniforms.tint * uniforms.intensity, src.a);
}
