// validate-prepend: ../../src/core/engine.wgsl
// camera/object come from the engine block (group 1)

// Camera-shape marker for the demo camera — a 4-sided open truncated cone,
// colored by world normal (port of OGL's NormalProgram). Mirrors the little
// "camera" gizmo the OGL frustum-culling example parents to the demo camera.

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal   : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
  out.vNormal = normalize(object.normalMatrix * in.normal);
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal), 1.0);
}
