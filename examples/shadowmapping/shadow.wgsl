struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(v.position, 1.0);
  return out;
}
