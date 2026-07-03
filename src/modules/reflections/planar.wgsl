// Mirror-surface material for PlanarReflector. Samples the reflection target
// with a screen-projected uv: for points ON the mirror plane the mirrored
// camera's clip coords equal the main camera's (reflection fixes plane points,
// oblique clip only rewrites the z row), so the fragment's own clip position
// addresses the reflection texture directly — no texture matrix needed.

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  uBaseColor : vec3f,
  uRoughness : f32,
  uMaxLod : f32,
  uReflectivity : f32,
  uFresnelPower : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var reflectionSampler : sampler;
@group(0) @binding(2) var tReflection : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vClipPos : vec4f,
  @location(1) vNormal : vec3f,
  @location(2) vWorldPos : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  let clipPos = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = clipPos;
  out.vClipPos = clipPos;
  out.vNormal = uniforms.normalMatrix * in.normal;
  out.vWorldPos = (uniforms.modelMatrix * vec4f(in.position, 1.0)).xyz;
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let ndc = in.vClipPos.xy / in.vClipPos.w;
  // ndc y-up -> texture v-down
  let uv = vec2f(ndc.x, -ndc.y) * 0.5 + 0.5;

  // glossy tier: roughness walks the blurred mip chain (uMaxLod 0 = sharp only)
  let lod = clamp(uniforms.uRoughness, 0.0, 1.0) * uniforms.uMaxLod;
  let reflection = textureSampleLevel(tReflection, reflectionSampler, uv, lod).rgb;

  let n = normalize(in.vNormal);
  let v = normalize(uniforms.cameraPosition - in.vWorldPos);
  let fresnel = pow(1.0 - max(dot(n, v), 0.0), max(uniforms.uFresnelPower, 0.001));
  let strength = clamp(uniforms.uReflectivity + (1.0 - uniforms.uReflectivity) * fresnel, 0.0, 1.0);

  let color = mix(uniforms.uBaseColor, reflection, strength);
  return vec4f(color, 1.0);
}
