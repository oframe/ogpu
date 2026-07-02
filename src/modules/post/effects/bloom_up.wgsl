// 9-tap tent upsample. Drawn with additive blending (one/one) into the next
// mip up — the accumulate that gives convolution bloom its spread. `radius`
// scales the tent in source texels.

struct Uniforms {
  radius : f32,
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
  let t = uniforms.radius / vec2f(textureDimensions(tMap));
  let uv = in.vUv;

  var col = textureSample(tMap, mapSampler, uv + t * vec2f(-1.0, -1.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(0.0, -1.0)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(1.0, -1.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(-1.0, 0.0)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv).rgb * 4.0;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(1.0, 0.0)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(-1.0, 1.0)).rgb;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(0.0, 1.0)).rgb * 2.0;
  col += textureSample(tMap, mapSampler, uv + t * vec2f(1.0, 1.0)).rgb;

  return vec4f(col / 16.0, 1.0);
}
