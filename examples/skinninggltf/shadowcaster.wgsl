// validate-prepend: ../../src/core/engine.wgsl
// Shadow caster pass. Pulls skinned positions from the Skin compute storage
// buffer (so the cast shadow tracks the animation) and writes depth from the
// light's POV. Vertex-only module -> no fragment stage, so it draws into the
// depth-only shadow RenderTarget.

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
  return camera.projectionMatrix * camera.viewMatrix * object.modelMatrix * vec4f(position, 1.0);
}
