@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tFeedback : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

// Fullscreen triangle from gpu.TRIANGLE. Same top-origin uv.y flip as feedback.wgsl
// so tFeedback samples at a raw texel-identity read (fb is already screen-oriented).
// No uniforms here — so blit skips the dynamic offset (pipeline.hasDynamicUniform is
// false), and binding 0 is the sampler, not the engine's per-draw uniform slot.
@vertex
fn vs(v : Vertex) -> VertexOutput {
  var o : VertexOutput;
  o.position = vec4f(v.position, 1.0);
  o.vUv = vec2f(v.uv.x, 1.0 - v.uv.y);
  return o;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(textureSample(tFeedback, samp, in.vUv).rgb, 1.0);
}
