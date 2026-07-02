// DoF pass 2/3 — bokeh gather at half res: golden-angle spiral disc,
// foreground/background separated so near-field blur spills over sharp
// backgrounds (scatter-as-gather). a carries the foreground ratio.

struct Uniforms {
  bokehRadius : f32,
  taps : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>; // rgb = color, a = signed coc (px)

const PI = 3.14159265359;
const GOLDEN = 2.39996322973;

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

// tap contributes when its coc disc reaches `dist` (soft 2px edge)
fn weigh(coc: f32, dist: f32) -> f32 {
  return clamp((coc - dist + 2.0) / 2.0, 0.0, 1.0);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(tMap));
  let center = textureSampleLevel(tMap, mapSampler, in.vUv, 0.0);
  let taps = clamp(uniforms.taps, 4.0, 64.0);

  var bgColor = vec3f(0.0);
  var fgColor = vec3f(0.0);
  var bgWeight = 0.0;
  var fgWeight = 0.0;

  for (var i = 0.0; i < 64.0; i += 1.0) {
    if (i >= taps) { break; }
    let r = sqrt((i + 0.5) / taps) * uniforms.bokehRadius;
    let theta = i * GOLDEN;
    let offset = vec2f(cos(theta), sin(theta)) * r;

    let s = textureSampleLevel(tMap, mapSampler, in.vUv + offset * texel, 0.0);

    let bgw = weigh(max(0.0, min(s.a, center.a)), r);
    bgColor += s.rgb * bgw;
    bgWeight += bgw;

    let fgw = weigh(-s.a, r);
    fgColor += s.rgb * fgw;
    fgWeight += fgw;
  }

  bgColor /= max(bgWeight, 1e-4);
  fgColor /= max(fgWeight, 1e-4);

  let fgRatio = min(1.0, fgWeight * PI / taps);
  let col = mix(bgColor, fgColor, fgRatio);
  return vec4f(col, fgRatio);
}
