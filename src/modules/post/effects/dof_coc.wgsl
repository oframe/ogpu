// DoF pass 1/3 — half-res prefilter: box-downsampled scene color in rgb,
// signed circle-of-confusion in a (pixel units at half res; negative = near
// field, positive = far field).

struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  bokehRadius : f32,
  inverseProjectionMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tDepth : texture_depth_2d;

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

fn viewZ(uv: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(tDepth));
  let pix = vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * dims);
  let depth = textureLoad(tDepth, pix, 0);
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
  let v = uniforms.inverseProjectionMatrix * ndc;
  return -(v.z / v.w); // positive distance in front of the camera
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let t = 0.5 / vec2f(textureDimensions(tMap)); // half texel of the full-res source
  var col = textureSampleLevel(tMap, mapSampler, in.vUv + vec2f(-t.x, -t.y), 0.0).rgb;
  col += textureSampleLevel(tMap, mapSampler, in.vUv + vec2f(t.x, -t.y), 0.0).rgb;
  col += textureSampleLevel(tMap, mapSampler, in.vUv + vec2f(-t.x, t.y), 0.0).rgb;
  col += textureSampleLevel(tMap, mapSampler, in.vUv + vec2f(t.x, t.y), 0.0).rgb;
  col *= 0.25;

  let z = viewZ(in.vUv);
  let coc = clamp((z - uniforms.focusDistance) / max(uniforms.focusRange, 1e-3), -1.0, 1.0) * uniforms.bokehRadius;

  return vec4f(col, coc);
}
