// Dual-filter Kawase downsample for the glossy mip chain (same filter as
// post/blur_kawase_down.wgsl — duplicated on purpose: shaders are
// self-contained). Each mirror mip samples the previous level through this.

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
  let h = uniforms.offset * 0.5 / vec2f(textureDimensions(tMap));
  let uv = in.vUv;

  var col = textureSample(tMap, mapSampler, uv).rgb * 4.0;
  col += textureSample(tMap, mapSampler, uv + vec2f(-h.x, -h.y)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(h.x, -h.y)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(-h.x, h.y)).rgb;
  col += textureSample(tMap, mapSampler, uv + vec2f(h.x, h.y)).rgb;

  return vec4f(col / 8.0, 1.0);
}
