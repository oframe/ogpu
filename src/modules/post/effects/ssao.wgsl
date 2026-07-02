// Classic hemisphere-kernel SSAO (Crytek-style, normal-oriented). The cheap
// tier — kernel comes in through the uniform block, rotation from in-shader
// interleaved gradient noise. Outputs AO in r.

struct Uniforms {
  resolution : vec2f,
  radius : f32,
  bias : f32,
  power : f32,
  kernelSize : f32,
  frameIndex : f32,
  projectionMatrix : mat4x4f,
  inverseProjectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  kernel : array<vec4f, 32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tNormal : texture_2d<f32>;
@group(0) @binding(3) var tDepth : texture_depth_2d;

const PI = 3.14159265359;

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

fn ign(pix: vec2f) -> f32 {
  let p = pix + 5.588238 * (uniforms.frameIndex % 64.0);
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.vUv;
  let depth = loadDepth(uv);
  if (depth >= 1.0) {
    return vec4f(1.0);
  }

  let p = viewPos(uv, depth);
  let worldN = textureSampleLevel(tNormal, mapSampler, uv, 0.0).xyz;
  if (dot(worldN, worldN) < 0.1) {
    return vec4f(1.0);
  }
  let n = normalize((uniforms.viewMatrix * vec4f(normalize(worldN), 0.0)).xyz);

  // random tangent frame from IGN rotation
  let angle = ign(uv * uniforms.resolution) * 2.0 * PI;
  let rand = vec3f(cos(angle), sin(angle), 0.0);
  let tangent = normalize(rand - n * dot(rand, n));
  let bitangent = cross(n, tangent);
  let tbn = mat3x3f(tangent, bitangent, n);

  let kernelSize = clamp(uniforms.kernelSize, 1.0, 32.0);
  var occlusion = 0.0;

  for (var i = 0; i < 32; i++) {
    if (f32(i) >= kernelSize) { break; }
    let samplePos = p + (tbn * uniforms.kernel[i].xyz) * uniforms.radius;

    let clip = uniforms.projectionMatrix * vec4f(samplePos, 1.0);
    let ndc = clip.xy / clip.w;
    let sUv = ndc * vec2f(0.5, -0.5) + 0.5;
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) { continue; }

    let sceneZ = viewPos(sUv, loadDepth(sUv)).z;
    let rangeCheck = smoothstep(0.0, 1.0, uniforms.radius / max(abs(p.z - sceneZ), 1e-4));
    occlusion += select(0.0, 1.0, sceneZ >= samplePos.z + uniforms.bias) * rangeCheck;
  }

  let ao = pow(clamp(1.0 - occlusion / kernelSize, 0.0, 1.0), uniforms.power);
  return vec4f(ao, ao, ao, 1.0);
}
