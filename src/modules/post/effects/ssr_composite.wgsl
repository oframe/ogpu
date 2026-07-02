// SSR pass 2/2 — full-res composite: reflection added by schlick fresnel ×
// intensity × trace confidence. Linear HDR in/out.

struct Uniforms {
  intensity : f32,
  fresnelPower : f32,
  f0 : f32,
  inverseProjectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tReflection : texture_2d<f32>;
@group(0) @binding(4) var tNormal : texture_2d<f32>;
@group(0) @binding(5) var tDepth : texture_depth_2d;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(in.position, 1.0);
  out.vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  return out;
}

fn loadDepth(uv: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(tDepth));
  let pix = vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * dims);
  return textureLoad(tDepth, pix, 0);
}

fn viewPos(uv: vec2f, depth: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
  let v = uniforms.inverseProjectionMatrix * ndc;
  return v.xyz / v.w;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let src = textureSample(tMap, mapSampler, in.vUv);
  let depth = loadDepth(in.vUv);
  if (depth >= 1.0) {
    return src;
  }

  let worldN = textureSampleLevel(tNormal, mapSampler, in.vUv, 0.0).xyz;
  if (dot(worldN, worldN) < 0.1) {
    return src;
  }

  let refl = textureSampleLevel(tReflection, mapSampler, in.vUv, 0.0);
  if (refl.a < 1e-3) {
    return src;
  }

  let p = viewPos(in.vUv, depth);
  let n = normalize((uniforms.viewMatrix * vec4f(normalize(worldN), 0.0)).xyz);
  let cosTheta = clamp(dot(-normalize(p), n), 0.0, 1.0);
  let fresnel = uniforms.f0 + (1.0 - uniforms.f0) * pow(1.0 - cosTheta, uniforms.fresnelPower);

  return vec4f(src.rgb + refl.rgb * refl.a * fresnel * uniforms.intensity, src.a);
}
