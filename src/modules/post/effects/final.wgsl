// Final pass — the HDR→LDR boundary. Order: exposure → white balance (linear)
// → tonemap → lift/gamma/gain → contrast → saturation (display-referred)
// → vignette → sRGB encode. toneMapping: 0 none, 1 aces, 2 agx, 3 neutral,
// 4 reinhard, 5 uncharted2.

struct Uniforms {
  resolution : vec2f,
  exposure : f32,
  contrast : f32,
  saturation : f32,
  temperature : f32,
  tint : f32,
  toneMapping : u32,
  lift : vec3f,
  gamma : vec3f,
  gain : vec3f,
  vignetteColor : vec3f,
  vignetteAmount : f32,
  vignetteRadius : f32,
  vignetteSmoothness : f32,
  vignetteRoundness : f32,
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

// --- tonemappers ---------------------------------------------------------

// ACES fitted (Stephen Hill). Matrices are row-major sources written as columns.
const acesInput = mat3x3f(
  vec3f(0.59719, 0.07600, 0.02840),
  vec3f(0.35458, 0.90834, 0.13383),
  vec3f(0.04823, 0.01566, 0.83777),
);
const acesOutput = mat3x3f(
  vec3f(1.60475, -0.10208, -0.00327),
  vec3f(-0.53108, 1.10813, -0.07276),
  vec3f(-0.07367, -0.00605, 1.07602),
);

fn rrtOdtFit(v: vec3f) -> vec3f {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

fn tonemapAces(c: vec3f) -> vec3f {
  return clamp(acesOutput * rrtOdtFit(acesInput * c), vec3f(0.0), vec3f(1.0));
}

// AgX minimal (Wrensch/Sobotka approximation); ends in linear via 2.2 decode.
const agxMat = mat3x3f(
  vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
  vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104),
);
const agxMatInv = mat3x3f(
  vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
  vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
  vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116),
);

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn tonemapAgx(c: vec3f) -> vec3f {
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = agxMat * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  v = agxMatInv * v;
  return clamp(pow(max(v, vec3f(0.0)), vec3f(2.2)), vec3f(0.0), vec3f(1.0));
}

// Khronos PBR Neutral.
fn tonemapNeutral(color: vec3f) -> vec3f {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  let x = min(color.r, min(color.g, color.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = color - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) {
    return clamp(c, vec3f(0.0), vec3f(1.0));
  }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return clamp(mix(c, vec3f(newPeak), g), vec3f(0.0), vec3f(1.0));
}

fn tonemapReinhard(c: vec3f) -> vec3f {
  return c / (vec3f(1.0) + c);
}

fn uncharted2Partial(x: vec3f) -> vec3f {
  let a = 0.15; let b = 0.50; let c = 0.10; let d = 0.20; let e = 0.02; let f = 0.30;
  return ((x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f)) - e / f;
}

fn tonemapUncharted2(c: vec3f) -> vec3f {
  let exposureBias = 2.0;
  let whitePoint = vec3f(11.2);
  let curr = uncharted2Partial(c * exposureBias);
  let whiteScale = vec3f(1.0) / uncharted2Partial(whitePoint);
  return clamp(curr * whiteScale, vec3f(0.0), vec3f(1.0));
}

// --- helpers --------------------------------------------------------------

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let src = textureSample(tMap, mapSampler, in.vUv);
  var col = src.rgb;

  // linear-space grading
  col *= uniforms.exposure;
  // lightweight white-balance approximation: temperature warms/cools r↔b,
  // tint shifts green↔magenta
  col *= vec3f(1.0 + uniforms.temperature * 0.1, 1.0 + uniforms.tint * 0.1, 1.0 - uniforms.temperature * 0.1);

  // tonemap — the linear→display boundary
  switch (uniforms.toneMapping) {
    case 1u: { col = tonemapAces(col); }
    case 2u: { col = tonemapAgx(col); }
    case 3u: { col = tonemapNeutral(col); }
    case 4u: { col = tonemapReinhard(col); }
    case 5u: { col = tonemapUncharted2(col); }
    default: { col = clamp(col, vec3f(0.0), vec3f(1.0)); }
  }

  // display-referred grading
  col = pow(max(col * uniforms.gain + uniforms.lift * (vec3f(1.0) - col), vec3f(0.0)), vec3f(1.0) / max(uniforms.gamma, vec3f(0.01)));
  col = (col - 0.5) * uniforms.contrast + 0.5;
  col = mix(vec3f(luminance(col)), col, uniforms.saturation);
  col = clamp(col, vec3f(0.0), vec3f(1.0));

  // vignette
  let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
  var p = in.vUv * 2.0 - 1.0;
  p.x *= mix(1.0, aspect, uniforms.vignetteRoundness);
  let vig = smoothstep(uniforms.vignetteRadius, uniforms.vignetteRadius - max(uniforms.vignetteSmoothness, 1e-4), length(p));
  col = mix(mix(col, uniforms.vignetteColor, uniforms.vignetteAmount), col, vig);

  return vec4f(linearToSrgb(col), src.a);
}
