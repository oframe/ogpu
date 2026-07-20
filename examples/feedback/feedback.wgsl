struct Uniforms {
  uDecay : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tScene : texture_2d<f32>;   // this frame's scene render
@group(0) @binding(3) var tPrev : texture_2d<f32>;    // last frame's accumulation

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

// Fullscreen triangle from gpu.TRIANGLE. Flip uv.y here to top-origin (match the
// texture's texel grid) so every sample below is a raw texel-identity read — the
// feedback read/write land on the same texel, no per-sample flip needed.
@vertex
fn vs(v : Vertex) -> VertexOutput {
  var o : VertexOutput;
  o.position = vec4f(v.position, 1.0);
  o.vUv = vec2f(v.uv.x, 1.0 - v.uv.y);
  return o;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  let scene = textureSample(tScene, samp, in.vUv).rgb;
  let prev = textureSample(tPrev, samp, in.vUv).rgb;
  let acc = mix(scene, prev, uniforms.uDecay);
  return vec4f(acc, 1.0);
}
