// validate-prepend: ../../src/core/engine.wgsl
// `camera` and `object` (group 1) come from the engine block Shader appends

struct Vertex {
  @location(0) position : vec3f,
}

@vertex
fn vs(in : Vertex) -> @builtin(position) vec4f {
  return camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
}
