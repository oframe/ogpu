// Separable gaussian blur, 17 taps, sigma derived from radius. `direction`
// selects the axis ((1,0) then (0,1)); mixAmount folds the final composite
// into the second pass: out = mix(tSource, blur, mixAmount) — the H pass runs
// with mixAmount = 1 (pure blur).

struct Uniforms {
  direction : vec2f,
  radius : f32,
  mixAmount : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tSource : texture_2d<f32>;

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
  let texel = uniforms.direction / vec2f(textureDimensions(tMap));
  let radius = max(uniforms.radius, 1e-3);
  let sigma = radius * 0.5;

  var col = vec3f(0.0);
  var total = 0.0;
  for (var i = -8; i <= 8; i++) {
    let x = f32(i) / 8.0 * radius;
    let w = exp(-(x * x) / (2.0 * sigma * sigma));
    col += textureSample(tMap, mapSampler, in.vUv + texel * x).rgb * w;
    total += w;
  }
  col /= total;

  let src = textureSample(tSource, mapSampler, in.vUv);
  return vec4f(mix(src.rgb, col, uniforms.mixAmount), src.a);
}
