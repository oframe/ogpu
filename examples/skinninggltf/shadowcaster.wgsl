// Shadow caster pass. Pulls skinned positions from the Skin compute storage
// buffer (so the cast shadow tracks the animation) and writes depth from the
// light's POV. Vertex-only module -> RenderPipeline emits no fragment stage and
// the pipeline has no color target.

struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> positionBuffer : array<f32>;

struct Vertex {
  @builtin(vertex_index) vertexIndex : u32,
}

@vertex
fn vs(in : Vertex) -> @builtin(position) vec4f {
  let position = vec3f(
    positionBuffer[in.vertexIndex * 3],
    positionBuffer[in.vertexIndex * 3 + 1],
    positionBuffer[in.vertexIndex * 3 + 2]
  );
  return uniforms.projectionMatrix * uniforms.viewMatrix * uniforms.modelMatrix * vec4f(position, 1.0);
}
