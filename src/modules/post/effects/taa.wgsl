// TAA resolve: reproject history via depth + unjittered current/previous
// view-projection (camera-motion velocity, v1 — no per-object motion
// vectors), 3x3 neighborhood min/max clamp against ghosting, exponential
// history blend. Runs in linear HDR.

struct Uniforms {
  resolution : vec2f,
  blend : f32,
  firstFrame : f32,
  prevViewProjectionMatrix : mat4x4f,
  inverseViewProjectionMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tHistory : texture_2d<f32>;
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

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.vUv;
  let current = textureSampleLevel(tMap, mapSampler, uv, 0.0);

  if (uniforms.firstFrame > 0.5) {
    return current;
  }

  // reproject through world space
  let depth = loadDepth(uv);
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
  let w = uniforms.inverseViewProjectionMatrix * ndc;
  let world = w.xyz / w.w;

  let prevClip = uniforms.prevViewProjectionMatrix * vec4f(world, 1.0);
  let prevNdc = prevClip.xyz / prevClip.w;
  let prevUv = prevNdc.xy * vec2f(0.5, -0.5) + 0.5;

  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    return current;
  }

  var history = textureSampleLevel(tHistory, mapSampler, prevUv, 0.0).rgb;

  // neighborhood clamp — the ghosting guard for disoccluded / moving content
  let texel = 1.0 / uniforms.resolution;
  var minC = current.rgb;
  var maxC = current.rgb;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) { continue; }
      let c = textureSampleLevel(tMap, mapSampler, uv + vec2f(f32(x), f32(y)) * texel, 0.0).rgb;
      minC = min(minC, c);
      maxC = max(maxC, c);
    }
  }
  history = clamp(history, minC, maxC);

  return vec4f(mix(current.rgb, history, uniforms.blend), current.a);
}
