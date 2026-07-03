// Simple hemisphere + sun lit content shader. Rendered into the swapchain,
// both planar reflection targets and the probe faces — same formats, one
// pipeline (built with cullMode 'none': winding flips under mirrors/probes).

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  uColor : vec3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.vNormal = uniforms.normalMatrix * in.normal;
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.vNormal);
  let sky = vec3f(0.75, 0.8, 0.9);
  let ground = vec3f(0.22, 0.2, 0.19);
  let hemi = mix(ground, sky, n.y * 0.5 + 0.5);
  let sun = max(dot(n, normalize(vec3f(0.5, 0.8, 0.3))), 0.0);
  let color = uniforms.uColor * (hemi * 0.6 + sun * 0.6);
  return vec4f(color, 1.0);
}
