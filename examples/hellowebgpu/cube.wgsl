// validate-prepend: ../../src/core/engine.wgsl
// `camera` and `object` (group 1) come from the engine block Shader appends

struct Uniforms {
  uScale: f32,
  uAlpha: f32,
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
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;

  let localPos = in.position * uniforms.uScale;

  vsOut.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(localPos, 1.0)));
  vsOut.vNormal = object.normalMatrix * in.normal;
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal), uniforms.uAlpha);
}
