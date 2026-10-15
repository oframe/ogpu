// validate-prepend: ../../src/core/engine.wgsl
// camera/object come from the engine block
@group(0) @binding(0) var textureSampler: sampler;
@group(0) @binding(1) var tMap: texture_2d<f32>;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;
  vsOut.position = camera.projectionMatrix * object.modelViewMatrix * vec4f(in.position, 1.0);
  vsOut.vUv = vec2f(in.uv.x, 1.0 - in.uv.y); // flip y to match OGL's orientation
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(textureSample(tMap, textureSampler, in.vUv * 2.0).rgb, 1.0);
}
