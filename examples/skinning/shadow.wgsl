// Baked occlusion plane under the character. Samples the shadow map's green
// channel as alpha and draws flat black, so the transparent pass darkens the
// white floor only where the model is grounded.
struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  resolution : vec2f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var shadowSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;

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
  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let shadow = textureSample(tMap, shadowSampler, in.vUv).g;
  return vec4f(0.0, 0.0, 0.0, shadow);
}
