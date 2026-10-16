// Engine block: Shader appends this to every Mesh shader. group(1) and group(3)
// are the engine's — fixed layouts (Renderer.engineLayout, Renderer.timeLayout),
// never reflected.

struct Camera {
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  cameraPosition: vec3f,
  cameraQuaternion: vec4f,
  viewport: vec2f, // target size, else the bound canvas size
}

// Depends on the mesh alone, not the camera. normalMatrix/objectMatrix are
// only written when the shader reads them (Shader.needs).
struct Object {
  modelMatrix: mat4x4f,
  normalMatrix: mat3x3f,
  objectMatrix: mat4x4f,
}

@group(1) @binding(0) var<uniform> camera: Camera; // 176 B, one slot per render()
@group(1) @binding(1) var<uniform> object: Object; // 176 B, one fixed slot per mesh

// Seconds: time = renderer.time, delta = renderer.deltaTime. One value per
// submit, written by render() only when it changed; bound once per pass.
struct Time {
  time: f32,
  delta: f32,
}

@group(3) @binding(0) var<uniform> time: Time;

// view * model. Per vertex, prefer camera.viewMatrix * (object.modelMatrix * p):
// two mat-vec products instead of a mat-mat one.
fn modelViewMatrix() -> mat4x4f {
  return camera.viewMatrix * object.modelMatrix;
}
