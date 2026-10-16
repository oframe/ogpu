// validate-prepend: ../../../../src/core/engine.wgsl
// Annotated reference of what scaffold.py emits (it writes the prepend path
// relative to the generated file, e.g. ../../src/core/engine.wgsl in examples/<name>/).
// `camera` (per pass), `object` (per mesh) at group(1) and `time` at group(3) come from
// the engine block Shader appends: read camera.projectionMatrix / viewMatrix / cameraPosition /
// cameraQuaternion / viewport, object.modelMatrix / normalMatrix / objectMatrix and
// time.time / time.delta instead of declaring them. View space is
// camera.viewMatrix * (object.modelMatrix * p), associated right to left (mat-vec only). Vertex entry `vs`, fragment `fs`.
// Fragment outputs the normal mapped to 0..1. Layer custom uniforms (a `Uniforms`
// struct at @group(0) @binding(0) named `uniforms`), textures, and shading on top.

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
  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));
  out.vNormal = object.normalMatrix * in.normal;
  out.vUv = in.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal) * 0.5 + 0.5, 1.0);
}
