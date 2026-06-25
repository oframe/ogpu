struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  viewMatrix: mat4x4f,
  normalMatrix : mat3x3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
  @location(2) vWorldPos : vec3f
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var out : VertexOutput;

  let worldPos = uniforms.modelMatrix * vec4(v.position, 1.0);
  out.vWorldPos = worldPos.xyz;

  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
  out.vNormal = uniforms.normalMatrix * v.normal;
  out.vUv = v.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {

  let lightPos = vec3f(0.0, 2.0, 0.0);
  let light = max(0.0, dot(in.vNormal, normalize(lightPos)));


  return vec4f(vec3f(light), 1.0);
}
