// Engine block: Shader appends this to every Mesh shader. group(1) is the
// engine's — the layout is fixed (Renderer.engineLayout), never reflected.

struct Camera {
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  cameraPosition: vec3f,
  time: f32,
  cameraQuaternion: vec4f,
  resolution: vec2f,
}

struct Object {
  modelMatrix: mat4x4f,
  modelViewMatrix: mat4x4f,
  normalMatrix: mat3x3f,
  objectMatrix: mat4x4f,
}

@group(1) @binding(0) var<uniform> camera: Camera; // 176 B, one slice per pass
@group(1) @binding(1) var<uniform> object: Object; // 240 B, one slice per draw
