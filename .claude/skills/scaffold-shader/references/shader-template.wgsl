// Annotated reference of what scaffold.py emits.
// Conventions: uniform block named `uniforms`, vertex entry `vs`, fragment `fs`.
// Standard uniform fields are written by Mesh.draw by name — declare only what
// you use. Fragment outputs the normal mapped to 0..1. Layer custom uniforms,
// textures, and shading on top with Edit after generating.

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  normalMatrix : mat3x3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

// Attribute order must match the geometry's data order.
// @core/primitives emit: position (0), normal (1), uv (2).
struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.vNormal = uniforms.normalMatrix * in.normal;
  out.vUv = in.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal) * 0.5 + 0.5, 1.0);
}
