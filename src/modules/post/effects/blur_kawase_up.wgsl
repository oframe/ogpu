// Dual-filter Kawase upsample (Bjørge): 8 taps, diagonals double-weighted.

struct Uniforms {
  offset : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;

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
  let h = uniforms.offset / vec2f(textureDimensions(tMap));
  let uv = in.vUv;

  var col = textureSample(tMap, mapSampler, uv + vec2f(-h.x * 2.0, 0.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(-h.x, h.y)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + vec2f(0.0, h.y * 2.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(h.x, h.y)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + vec2f(h.x * 2.0, 0.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(h.x, -h.y)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + vec2f(0.0, -h.y * 2.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(-h.x, -h.y)).rgb * 2.0;

  return vec4f(col / 12.0, 1.0);
}
