// SSR pass 1/2 — half-res view-space raymarch against the depth buffer with
// binary refinement. rgb = reflected color, a = hit confidence (screen-edge,
// travel-distance and backface fades). Screen-space only: reflects what's on
// screen, by design.

struct Uniforms {
  resolution : vec2f,
  maxDistance : f32,
  thickness : f32,
  steps : f32,
  frameIndex : f32,
  projectionMatrix : mat4x4f,
  inverseProjectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tNormal : texture_2d<f32>;
@group(0) @binding(4) var tDepth : texture_depth_2d;

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

fn toUv(p: vec3f) -> vec2f {
  let clip = uniforms.projectionMatrix * vec4f(p, 1.0);
  let ndc = clip.xy / clip.w;
  return ndc * vec2f(0.5, -0.5) + 0.5;
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
    return vec4f(0.0);
  }

  let worldN = textureSampleLevel(tNormal, mapSampler, uv, 0.0).xyz;
  if (dot(worldN, worldN) < 0.1) {
    return vec4f(0.0);
  }

  let p = viewPos(uv, depth);
  let n = normalize((uniforms.viewMatrix * vec4f(normalize(worldN), 0.0)).xyz);
  let viewDir = normalize(p);
  let r = reflect(viewDir, n);

  let steps = clamp(uniforms.steps, 4.0, 64.0);
  let stepLen = uniforms.maxDistance / steps;
  let jitter = ign(uv * uniforms.resolution);

  var rayPos = p + r * stepLen * jitter;
  var hitUv = vec2f(-1.0);
  var hit = false;
  var travel = 0.0;

  for (var i = 0.0; i < 64.0; i += 1.0) {
    if (i >= steps) { break; }
    rayPos += r * stepLen;
    travel = (i + 1.0 + jitter) / steps;

    let sUv = toUv(rayPos);
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) { break; }

    let sceneZ = viewPos(sUv, loadDepth(sUv)).z;
    if (rayPos.z <= sceneZ && rayPos.z >= sceneZ - uniforms.thickness) {
      // binary refine
      var lo = rayPos - r * stepLen;
      var hi = rayPos;
      for (var b = 0; b < 4; b++) {
        let mid = (lo + hi) * 0.5;
        let mUv = toUv(mid);
        let mZ = viewPos(mUv, loadDepth(mUv)).z;
        if (mid.z <= mZ) { hi = mid; } else { lo = mid; }
      }
      hitUv = toUv(hi);
      hit = true;
      break;
    }
  }

  if (!hit) {
    return vec4f(0.0);
  }

  let col = textureSampleLevel(tMap, mapSampler, hitUv, 0.0).rgb;

  // fades: screen border, travel distance, rays heading back at the camera
  let border = min(hitUv, 1.0 - hitUv);
  let edgeFade = clamp(min(border.x, border.y) * 12.0, 0.0, 1.0);
  let distFade = 1.0 - travel * travel;
  let backFade = clamp(1.0 - r.z * 2.0, 0.0, 1.0);

  return vec4f(col, edgeFade * distFade * backFade);
}
