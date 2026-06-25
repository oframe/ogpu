struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
}

struct Scale {
  scale: f32,
}

struct Alpha {
  alpha: f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<uniform> scaleUniform : Scale;
@group(0) @binding(2) var<uniform> alphaUniform : Alpha;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;

  var localPos = in.position;
  localPos *= scaleUniform.scale;

  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(localPos, 1.0);
  vsOut.vNormal = uniforms.normalMatrix * in.normal;
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal), alphaUniform.alpha);
}
