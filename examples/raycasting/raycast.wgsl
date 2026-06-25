struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
  uHit: f32,
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
  vsOut.vNormal = normalize(uniforms.normalMatrix * in.normal);
  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(in.vNormal);
  let lighting = dot(normal, normalize(vec3f(-0.3, 0.8, 0.6)));
  let color = mix(vec3f(0.2, 0.8, 1.0), vec3f(1.0, 0.2, 0.8), uniforms.uHit);
  return vec4f(color + lighting * 0.1, 1.0);
}
