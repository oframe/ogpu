// validate-prepend: ../../src/core/engine.wgsl
// `camera` and `object` (group 1) come from the engine block Shader appends
// Baked occlusion plane under the character. Samples the shadow map's green
// channel as alpha and draws flat black, so the transparent pass darkens the
// white floor only where the model is grounded.
@group(0) @binding(0) var shadowSampler : sampler;
@group(0) @binding(1) var tMap : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut : VertexOutput;
  vsOut.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let shadow = textureSample(tMap, shadowSampler, in.vUv).g;
  return vec4f(0.0, 0.0, 0.0, shadow);
}
