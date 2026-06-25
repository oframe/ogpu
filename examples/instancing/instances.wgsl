struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
  time: f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var tMap: texture_2d<f32>;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) offset: vec3f,
  @location(4) random: vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
}

fn rotate2d(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;

  var pos = in.position;

  pos *= 0.9 + in.random.y * 0.2;

  let xz = rotate2d(pos.xz, in.random.x * 6.28 + 4.0 * uniforms.time * (in.random.y - 0.5));
  pos.x = xz.x;
  pos.z = xz.y;

  let zy = rotate2d(pos.zy, in.random.z * 0.5 * sin(uniforms.time * in.random.x + in.random.z * 3.14));
  pos.z = zy.x;
  pos.y = zy.y;

  pos += in.offset;

  vsOut.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(pos, 1.0);
  vsOut.vNormal = uniforms.normalMatrix * in.normal;
  vsOut.vUv = in.uv;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let tex = textureSample(tMap, textureSampler, vec2f(in.vUv.x, 1.0 - in.vUv.y)).rgb;
  return vec4f(tex, 1.0);
}
