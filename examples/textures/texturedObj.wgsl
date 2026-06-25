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
@group(0) @binding(1) var sampler2d: sampler;
@group(0) @binding(2) var testTexture: texture_2d<f32>;

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

  let localPos = in.position;

  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(localPos, 1.0);
  vsOut.vNormal = uniforms.normalMatrix * in.normal;
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let tex = textureSample(testTexture, sampler2d, in.vUv).rgb;
  let normal = normalize(in.vNormal);

  let light = normalize(vec3f(0.5, 1.0, -0.3));
  let shading = dot(normal, light) * 0.15;

  return vec4f(tex + shading, 1.0);
}
