// Depth-aware separable blur for the AO buffer — smooths sampling noise
// without bleeding across depth discontinuities. `direction` picks the axis.

struct Uniforms {
  direction : vec2f,
  depthSharpness : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;
@group(0) @binding(3) var tDepth : texture_depth_2d;

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

const WEIGHTS = array<f32, 5>(0.2270270, 0.1945946, 0.1216216, 0.0540540, 0.0162162);

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let texel = uniforms.direction / vec2f(textureDimensions(tMap));
  let centerDepth = loadDepth(in.vUv);

  var total = textureSampleLevel(tMap, mapSampler, in.vUv, 0.0).r * WEIGHTS[0];
  var totalWeight = WEIGHTS[0];

  for (var i = 1; i <= 4; i++) {
    let offset = texel * f32(i);
    for (var s = -1.0; s < 2.0; s += 2.0) {
      let uv = in.vUv + offset * s;
      let d = loadDepth(uv);
      let w = WEIGHTS[i] * exp(-abs(d - centerDepth) * uniforms.depthSharpness);
      total += textureSampleLevel(tMap, mapSampler, uv, 0.0).r * w;
      totalWeight += w;
    }
  }

  let ao = total / max(totalWeight, 1e-4);
  return vec4f(ao, ao, ao, 1.0);
}
