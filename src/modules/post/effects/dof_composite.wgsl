// DoF pass 3/3 — full-res composite: blend sharp scene with half-res bokeh by
// the sharp CoC, unioned with the bokeh's foreground spill.

struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  bokehRadius : f32,
  inverseProjectionMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tBokeh : texture_2d<f32>;
@group(0) @binding(4) var tDepth : texture_depth_2d;

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
  return -(v.z / v.w);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let src = textureSample(tMap, mapSampler, in.vUv);
  let bokeh = textureSampleLevel(tBokeh, mapSampler, in.vUv, 0.0);

  let z = viewZ(in.vUv);
  let coc = clamp((z - uniforms.focusDistance) / max(uniforms.focusRange, 1e-3), -1.0, 1.0) * uniforms.bokehRadius;

  let dofStrength = smoothstep(0.1, 1.0, abs(coc));
  // union with foreground spill (screen blend keeps both contributions)
  let blend = dofStrength + bokeh.a - dofStrength * bokeh.a;

  return vec4f(mix(src.rgb, bokeh.rgb, blend), src.a);
}
