struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
  uScale: f32,
  uAlpha: f32
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
fn vs(v: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;

  let localPos = v.position;
  // localPos *= uniforms.uScale;

  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(localPos, 1.0);
  vsOut.vNormal = uniforms.normalMatrix * v.normal;
  vsOut.vUv = v.uv;
  return vsOut;
}

struct FragmentOutput {
  @location(0) color: vec4f,
  @location(1) normal: vec4f
}

@fragment
fn fs(in: VertexOutput) -> FragmentOutput {
  var fragColor: FragmentOutput;
  fragColor.color = vec4f(0.93, 0.93, 0.93, 1.0);
  fragColor.normal = vec4f(normalize(in.vNormal), 1.0);
  return fragColor;
}
