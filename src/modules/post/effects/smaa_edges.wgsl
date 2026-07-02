// SMAA pass 1/3 — luma edge detection with local contrast adaptation
// (Jimenez et al.). Runs on LDR post-tonemap input.

struct Uniforms {
  resolution : vec2f,
  threshold : f32,
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

fn lum(uv: vec2f) -> f32 {
  return dot(textureSampleLevel(tMap, mapSampler, uv, 0.0).rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let t = 1.0 / uniforms.resolution;
  let uv = in.vUv;

  let l = lum(uv);
  let lLeft = lum(uv + t * vec2f(-1.0, 0.0));
  let lTop = lum(uv + t * vec2f(0.0, -1.0));

  var delta = vec4f(abs(l - lLeft), abs(l - lTop), 0.0, 0.0);
  var edges = step(vec2f(uniforms.threshold), delta.xy);

  if (edges.x == 0.0 && edges.y == 0.0) {
    return vec4f(0.0);
  }

  let lRight = lum(uv + t * vec2f(1.0, 0.0));
  let lBottom = lum(uv + t * vec2f(0.0, 1.0));
  delta = vec4f(delta.xy, abs(l - lRight), abs(l - lBottom));

  var maxDelta = max(max(delta.x, delta.y), max(delta.z, delta.w));

  let lLeftLeft = lum(uv + t * vec2f(-2.0, 0.0));
  let lTopTop = lum(uv + t * vec2f(0.0, -2.0));
  let delta2 = abs(vec2f(lLeft, lTop) - vec2f(lLeftLeft, lTopTop));
  maxDelta = max(maxDelta, max(delta2.x, delta2.y));

  // local contrast adaptation: drop edges much weaker than their neighborhood
  edges *= step(vec2f(maxDelta), 2.0 * delta.xy);

  return vec4f(edges, 0.0, 1.0);
}
