// Probe-lit material: samples a ReflectionProbe cube with box projection
// (parallax-corrected cubemap, Lagarde 2012) and mip-level-as-roughness.

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  uBoxMin : vec3f,
  uBoxMax : vec3f,
  uProbePos : vec3f,
  uBaseColor : vec3f,
  uRoughness : f32,
  uMaxLod : f32,
  uReflectivity : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var probeSampler : sampler;
@group(0) @binding(2) var tEnv : texture_cube<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
  @location(1) vWorldPos : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.vNormal = uniforms.normalMatrix * in.normal;
  out.vWorldPos = (uniforms.modelMatrix * vec4f(in.position, 1.0)).xyz;
  return out;
}

// Intersect the reflection ray with the probe's box and re-aim it at the
// capture point. Zero direction components divide to ±inf, which the
// max/min chain resolves — no epsilon needed.
fn boxProject(dir: vec3f, worldPos: vec3f, boxMin: vec3f, boxMax: vec3f, probePos: vec3f) -> vec3f {
  let firstPlane = (boxMax - worldPos) / dir;
  let secondPlane = (boxMin - worldPos) / dir;
  let furthest = max(firstPlane, secondPlane);
  let dist = min(min(furthest.x, furthest.y), furthest.z);
  let hit = worldPos + dir * dist;
  return hit - probePos;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.vNormal);
  let v = normalize(uniforms.cameraPosition - in.vWorldPos);
  let reflDir = reflect(-v, n);

  let dir = boxProject(reflDir, in.vWorldPos, uniforms.uBoxMin, uniforms.uBoxMax, uniforms.uProbePos);
  let lod = clamp(uniforms.uRoughness, 0.0, 1.0) * uniforms.uMaxLod;
  let env = textureSampleLevel(tEnv, probeSampler, dir, lod).rgb;

  let fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let strength = clamp(uniforms.uReflectivity + (1.0 - uniforms.uReflectivity) * fresnel, 0.0, 1.0);
  let color = mix(uniforms.uBaseColor, env, strength);
  return vec4f(color, 1.0);
}
