// Bloom prefilter: soft-knee threshold + optional selective mask + Karis-style
// firefly clamp. maskMode: 0 = luminance threshold only, 1 = color-key
// (threshold still applies on the keyed result).

struct Uniforms {
  threshold : f32,
  knee : f32,
  maskMode : u32,
  tolerance : f32,
  keyColor : vec3f,
  karis : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mapSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;

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

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  var col = textureSample(tMap, mapSampler, in.vUv).rgb;

  // color-key selective mask: keep pixels whose chroma is near keyColor,
  // brightness-independent (both sides normalized)
  if (uniforms.maskMode == 1u) {
    let d = distance(normalize(col + vec3f(1e-4)), normalize(uniforms.keyColor + vec3f(1e-4)));
    col *= 1.0 - smoothstep(0.0, max(uniforms.tolerance, 1e-3), d);
  }

  // soft-knee threshold (Unity/Keijiro curve)
  let br = max(col.r, max(col.g, col.b));
  var soft = br - uniforms.threshold + uniforms.knee;
  soft = clamp(soft, 0.0, 2.0 * uniforms.knee);
  soft = soft * soft / (4.0 * uniforms.knee + 1e-4);
  let contribution = max(soft, br - uniforms.threshold) / max(br, 1e-4);
  col *= max(contribution, 0.0);

  // firefly tamer — luma-weighted average keeps single hot pixels from
  // strobing through the chain
  col = mix(col, col / (1.0 + luminance(col)), uniforms.karis);

  return vec4f(col, 1.0);
}
