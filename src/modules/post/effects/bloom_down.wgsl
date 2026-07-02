// 13-tap downsample (Jimenez, CoD:AW / Unreal-style convolution bloom).
// Texel size derives from the bound source — one uniform-free pipeline serves
// the whole mip chain.

@group(0) @binding(0) var mapSampler : sampler;
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
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(in.position, 1.0);
  out.vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(tMap));
  let uv = in.vUv;

  let a = textureSample(tMap, mapSampler, uv + t * vec2f(-2.0, -2.0)).rgb;
  let b = textureSample(tMap, mapSampler, uv + t * vec2f(0.0, -2.0)).rgb;
  let c = textureSample(tMap, mapSampler, uv + t * vec2f(2.0, -2.0)).rgb;
  let d = textureSample(tMap, mapSampler, uv + t * vec2f(-1.0, -1.0)).rgb;
  let e = textureSample(tMap, mapSampler, uv + t * vec2f(1.0, -1.0)).rgb;
  let f = textureSample(tMap, mapSampler, uv + t * vec2f(-2.0, 0.0)).rgb;
  let g = textureSample(tMap, mapSampler, uv).rgb;
  let h = textureSample(tMap, mapSampler, uv + t * vec2f(2.0, 0.0)).rgb;
  let i = textureSample(tMap, mapSampler, uv + t * vec2f(-1.0, 1.0)).rgb;
  let j = textureSample(tMap, mapSampler, uv + t * vec2f(1.0, 1.0)).rgb;
  let k = textureSample(tMap, mapSampler, uv + t * vec2f(-2.0, 2.0)).rgb;
  let l = textureSample(tMap, mapSampler, uv + t * vec2f(0.0, 2.0)).rgb;
  let m = textureSample(tMap, mapSampler, uv + t * vec2f(2.0, 2.0)).rgb;

  // inner 2x2 block dominates; four outer blocks share the rest
  var col = (d + e + i + j) * 0.125;
  col += (a + b + f + g) * 0.03125;
  col += (b + c + g + h) * 0.03125;
  col += (f + g + k + l) * 0.03125;
  col += (g + h + l + m) * 0.03125;

  return vec4f(col, 1.0);
}
