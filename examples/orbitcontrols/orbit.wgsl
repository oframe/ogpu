// validate-prepend: ../../src/core/engine.wgsl

@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var tMap: texture_2d<f32>;

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
  vsOut.vUv = in.uv;
  vsOut.vNormal = normalize(object.normalMatrix * in.normal);
  vsOut.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let tex = textureSample(tMap, textureSampler, vec2f(in.vUv.x, 1.0 - in.vUv.y)).rgb;
  let normal = normalize(in.vNormal);
  let light = normalize(vec3f(0.5, 1.0, -0.3));
  let shading = dot(normal, light) * 0.15;
  return vec4f(tex + shading, 1.0);
}
