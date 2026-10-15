// validate-prepend: ../../src/core/engine.wgsl
// camera/object come from the engine block
@group(0) @binding(0) var cubeSampler : sampler;
// cube texture rather than a 2d texture; sampled by a direction vector
@group(0) @binding(1) var tMap : texture_cube<f32>;

struct Vertex {
  @location(0) position : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vDir : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.vDir = normalize(in.position);
  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(textureSample(tMap, cubeSampler, in.vDir).rgb, 1.0);
}
