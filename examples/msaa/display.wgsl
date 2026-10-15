// validate-prepend: ../../src/core/engine.wgsl
@group(0) @binding(0) var textureSampler : sampler;
@group(0) @binding(1) var tMap : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = vec4f(in.position, 1.0);
  out.vUv = in.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return textureSample(tMap, textureSampler, vec2f(in.vUv.x, 1.0 - in.vUv.y));
}
