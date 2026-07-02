// SMAA pass 2/3 — blending-weight calculation from the edges buffer, using
// the precomputed area (160x560) and UNPACKED search (66x33, three.js layout)
// lookup textures. Diagonal and corner handling are omitted (straight-edge
// 1x quality); uv space is y-down which matches the original D3D convention.

struct Uniforms {
  resolution : vec2f,
  maxSearchSteps : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var linearSampler : sampler;
@group(0) @binding(2) var pointSampler : sampler;
@group(0) @binding(3) var tEdges : texture_2d<f32>;
@group(0) @binding(4) var tArea : texture_2d<f32>;
@group(0) @binding(5) var tSearch : texture_2d<f32>;

const AREATEX_MAX_DISTANCE = 16.0;
const AREATEX_PIXEL_SIZE = vec2f(1.0 / 160.0, 1.0 / 560.0);
const AREATEX_SUBTEX_SIZE = 1.0 / 7.0;

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

// Unpacked search texture: e (edge combination) maps straight to uv.
fn searchLength(e: vec2f, bias: f32, scale: f32) -> f32 {
  let coord = vec2f(bias + e.x * scale, e.y);
  return 255.0 * textureSampleLevel(tSearch, pointSampler, coord, 0.0).r;
}

fn searchXLeft(start: vec2f, end: f32, texel: vec2f) -> f32 {
  var coord = start;
  var e = vec2f(0.0, 1.0);
  for (var i = 0; i < 32; i++) {
    if (f32(i) >= uniforms.maxSearchSteps) { break; }
    e = textureSampleLevel(tEdges, linearSampler, coord, 0.0).rg;
    coord -= vec2f(2.0, 0.0) * texel;
    if (!(coord.x > end && e.y > 0.8281 && e.x == 0.0)) { break; }
  }
  var x = coord.x + 0.25 * texel.x;
  x += texel.x;
  x += 2.0 * texel.x;
  x -= texel.x * searchLength(e, 0.0, 0.5);
  return x;
}

fn searchXRight(start: vec2f, end: f32, texel: vec2f) -> f32 {
  var coord = start;
  var e = vec2f(0.0, 1.0);
  for (var i = 0; i < 32; i++) {
    if (f32(i) >= uniforms.maxSearchSteps) { break; }
    e = textureSampleLevel(tEdges, linearSampler, coord, 0.0).rg;
    coord += vec2f(2.0, 0.0) * texel;
    if (!(coord.x < end && e.y > 0.8281 && e.x == 0.0)) { break; }
  }
  var x = coord.x - 0.25 * texel.x;
  x -= texel.x;
  x -= 2.0 * texel.x;
  x += texel.x * searchLength(e, 0.5, 0.5);
  return x;
}

fn searchYUp(start: vec2f, end: f32, texel: vec2f) -> f32 {
  var coord = start;
  var e = vec2f(1.0, 0.0);
  for (var i = 0; i < 32; i++) {
    if (f32(i) >= uniforms.maxSearchSteps) { break; }
    e = textureSampleLevel(tEdges, linearSampler, coord, 0.0).rg;
    coord -= vec2f(0.0, 2.0) * texel;
    if (!(coord.y > end && e.x > 0.8281 && e.y == 0.0)) { break; }
  }
  var y = coord.y + 0.25 * texel.y;
  y += texel.y;
  y += 2.0 * texel.y;
  y -= texel.y * searchLength(e.yx, 0.0, 0.5);
  return y;
}

fn searchYDown(start: vec2f, end: f32, texel: vec2f) -> f32 {
  var coord = start;
  var e = vec2f(1.0, 0.0);
  for (var i = 0; i < 32; i++) {
    if (f32(i) >= uniforms.maxSearchSteps) { break; }
    e = textureSampleLevel(tEdges, linearSampler, coord, 0.0).rg;
    coord += vec2f(0.0, 2.0) * texel;
    if (!(coord.y < end && e.x > 0.8281 && e.y == 0.0)) { break; }
  }
  var y = coord.y - 0.25 * texel.y;
  y -= texel.y;
  y -= 2.0 * texel.y;
  y += texel.y * searchLength(e.yx, 0.5, 0.5);
  return y;
}

fn area(dist: vec2f, e1: f32, e2: f32) -> vec2f {
  var coord = AREATEX_MAX_DISTANCE * round(4.0 * vec2f(e1, e2)) + dist;
  coord = AREATEX_PIXEL_SIZE * coord + 0.5 * AREATEX_PIXEL_SIZE;
  // subsample index 0 (SMAA 1x) — no subtex offset
  return textureSampleLevel(tArea, linearSampler, coord, 0.0).rg;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let texel = 1.0 / uniforms.resolution;
  let uv = in.vUv;
  let pixcoord = uv * uniforms.resolution;
  let searchRange = 2.0 * uniforms.maxSearchSteps * texel;

  var weights = vec4f(0.0);
  let e = textureSampleLevel(tEdges, linearSampler, uv, 0.0).rg;

  if (e.y > 0.0) { // edge at north — horizontal blending
    var d: vec2f;

    let leftStart = uv + texel * vec2f(-0.25, -0.125);
    let leftEnd = uv.x - searchRange.x;
    d.x = searchXLeft(leftStart, leftEnd, texel);

    let e1 = textureSampleLevel(tEdges, linearSampler, vec2f(d.x, uv.y - 0.25 * texel.y), 0.0).r;

    let rightStart = uv + texel * vec2f(1.25, -0.125);
    let rightEnd = uv.x + searchRange.x;
    d.y = searchXRight(rightStart, rightEnd, texel);

    let e2 = textureSampleLevel(tEdges, linearSampler, vec2f(d.y + texel.x, uv.y - 0.25 * texel.y), 0.0).r;

    let dist = abs(round(d * uniforms.resolution.x - pixcoord.x));
    weights = vec4f(area(sqrt(dist), e1, e2), weights.zw);
  }

  if (e.x > 0.0) { // edge at west — vertical blending
    var d: vec2f;

    let upStart = uv + texel * vec2f(-0.125, -0.25);
    let upEnd = uv.y - searchRange.y;
    d.x = searchYUp(upStart, upEnd, texel);

    let e1 = textureSampleLevel(tEdges, linearSampler, vec2f(uv.x - 0.25 * texel.x, d.x), 0.0).g;

    let downStart = uv + texel * vec2f(-0.125, 1.25);
    let downEnd = uv.y + searchRange.y;
    d.y = searchYDown(downStart, downEnd, texel);

    let e2 = textureSampleLevel(tEdges, linearSampler, vec2f(uv.x - 0.25 * texel.x, d.y + texel.y), 0.0).g;

    let dist = abs(round(d * uniforms.resolution.y - pixcoord.y));
    weights = vec4f(weights.xy, area(sqrt(dist), e1, e2));
  }

  return weights;
}
