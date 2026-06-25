struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;
  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  vsOut.vNormal = uniforms.normalMatrix * in.normal;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal) * 0.5 + 0.5, 1.0);
}
