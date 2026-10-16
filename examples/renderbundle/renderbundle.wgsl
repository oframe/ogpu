// validate-prepend: ../../src/core/engine.wgsl

struct Uniforms {
  color: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) vNormal: vec3f,
}

@vertex
fn vs(v: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(v.position, 1.0)));
  out.vNormal = object.normalMatrix * v.normal;
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.vNormal);
  let light = max(dot(n, normalize(vec3f(0.4, 1.0, 0.3))), 0.0);
  return vec4f(uniforms.color.rgb * (0.3 + 0.7 * light), 1.0);
}
