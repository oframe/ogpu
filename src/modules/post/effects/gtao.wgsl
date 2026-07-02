// GTAO (ground-truth ambient occlusion, Jimenez et al.) — horizon-based AO
// with the cosine-weighted arc integral, straight-edge v1: no hi-z depth
// mips, spatial denoise handled by the separate bilateral blur. Outputs AO
// visibility in r. Noise = interleaved gradient noise, animated by frame for
// TAA to converge.

struct Uniforms {
  resolution : vec2f,
  radius : f32,
  power : f32,
  bias : f32,
  sliceCount : f32,
  stepsPerSlice : f32,
  projScale : f32,
  frameIndex : f32,
  inverseProjectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tNormal : texture_2d<f32>;
@group(0) @binding(3) var tDepth : texture_depth_2d;

const PI = 3.14159265359;
const HALF_PI = 1.57079632679;

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

// interleaved gradient noise, frame-animated
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
    return vec4f(1.0); // no normal written — treat as sky/unlit
  }
  let n = normalize((uniforms.viewMatrix * vec4f(normalize(worldN), 0.0)).xyz);
  let v = normalize(-p);

  let texel = 1.0 / uniforms.resolution;
  let pix = uv * uniforms.resolution;
  // world radius → screen pixels at this depth
  let screenRadius = clamp(uniforms.projScale * uniforms.radius / max(-p.z, 1e-4), 2.0, 256.0);

  let noiseSlice = ign(pix);
  let noiseStep = ign(pix + vec2f(17.0, 47.0));

  let sliceCount = max(uniforms.sliceCount, 1.0);
  let stepCount = max(uniforms.stepsPerSlice, 1.0);

  var visibility = 0.0;

  for (var s = 0.0; s < sliceCount; s += 1.0) {
    let phi = PI * (s + noiseSlice) / sliceCount;
    let omega = vec2f(cos(phi), sin(phi));

    // slice plane basis — omega marches in texture space (y-down); its
    // view-space counterpart flips y or the projected-normal sign breaks
    let dirV = vec3f(omega.x, -omega.y, 0.0);
    let orthoDir = dirV - dot(dirV, v) * v;
    let axis = normalize(cross(orthoDir, v));
    let projN = n - axis * dot(n, axis);
    let projNLen = length(projN);
    if (projNLen < 1e-4) { continue; }

    let cosNorm = clamp(dot(projN / projNLen, v), -1.0, 1.0);
    let nAngle = sign(dot(orthoDir, projN)) * acos(cosNorm);

    for (var side = 0.0; side < 2.0; side += 1.0) {
      let sideSign = side * 2.0 - 1.0; // -1, +1
      var horizonCos = -1.0;

      for (var st = 0.0; st < stepCount; st += 1.0) {
        let t = (st + noiseStep) / stepCount;
        let sUv = uv + sideSign * t * screenRadius * omega * texel;
        let sDepth = loadDepth(sUv);
        let sp = viewPos(sUv, sDepth);
        let delta = sp - p;
        let dist = length(delta);
        if (dist < 1e-4) { continue; }
        // bias fights depth-precision self-occlusion on flat, grazing surfaces
        let sCos = dot(delta / dist, v) - uniforms.bias;
        // distance falloff — samples past the radius stop occluding
        let falloff = clamp((uniforms.radius * 1.5 - dist) / (uniforms.radius * 0.5), 0.0, 1.0);
        horizonCos = max(horizonCos, mix(-1.0, sCos, falloff));
      }

      var h = acos(clamp(horizonCos, -1.0, 1.0));
      h = nAngle + clamp(sideSign * h - nAngle, -HALF_PI, HALF_PI);
      visibility += projNLen * (cosNorm + 2.0 * h * sin(nAngle) - cos(2.0 * h - nAngle)) * 0.25;
    }
  }

  visibility = clamp(visibility / sliceCount, 0.0, 1.0);
  let ao = pow(visibility, uniforms.power);
  return vec4f(ao, ao, ao, 1.0);
}
