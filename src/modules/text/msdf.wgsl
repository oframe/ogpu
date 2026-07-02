// MSDF text: median-of-3 decode with fwidth-scaled screen-px range — crisp
// at any scale/perspective. Straight-alpha output for the engine's
// transparent blending; near-zero alpha discarded. uBillboard keeps the
// glyph plane facing the camera (model rotation ignored, translation kept).

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  uColor : vec3f,
  uOpacity : f32,
  uOutlineColor : vec3f,
  uOutlineWidth : f32,
  uSoftness : f32,
  uPxRange : f32,
  uBillboard : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var fontSampler : sampler;
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
  if (uniforms.uBillboard > 0.5) {
    let origin = uniforms.modelViewMatrix * vec4f(0.0, 0.0, 0.0, 1.0);
    out.position = uniforms.projectionMatrix * (origin + vec4f(in.position, 0.0));
  } else {
    out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  }
  out.vUv = in.uv;
  return out;
}

fn median3(v: vec3f) -> f32 {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let msd = textureSample(tMap, fontSampler, in.vUv).rgb;
  let sd = median3(msd);

  // distance-field units → screen pixels at this footprint
  let unitRange = vec2f(uniforms.uPxRange) / vec2f(textureDimensions(tMap));
  let screenTexSize = vec2f(1.0) / fwidth(in.vUv);
  let screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  let soften = 1.0 + uniforms.uSoftness * 4.0;
  let dist = screenPxRange * (sd - 0.5) / soften;
  let fill = clamp(dist + 0.5, 0.0, 1.0);

  let outlineDist = screenPxRange * (sd - (0.5 - uniforms.uOutlineWidth)) / soften;
  let outline = clamp(outlineDist + 0.5, 0.0, 1.0);

  let alpha = max(fill, outline) * uniforms.uOpacity;
  if (alpha < 0.004) {
    discard;
  }

  // outline tint only where the outline band extends past the fill — a plain
  // fill/outline mix darkens edge pixels even at outlineWidth 0
  let col = mix(uniforms.uColor, uniforms.uOutlineColor, clamp(outline - fill, 0.0, 1.0));
  return vec4f(col, alpha);
}
