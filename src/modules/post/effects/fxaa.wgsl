// FXAA 3.11 (NVIDIA FXAA3_11 PC quality preset) on LDR post-tonemap input.
// Luma is the green-weighted dot on already-perceptual (sRGB-encoded) color —
// no sRGB conversion is done here.

struct Uniforms {
  resolution : vec2f,
  subpix : f32,
  edgeThreshold : f32,
  edgeThresholdMin : f32,
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

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn sampleRgb(uv: vec2f) -> vec3f {
  return textureSampleLevel(tMap, mapSampler, uv, 0.0).rgb;
}

fn sampleLuma(uv: vec2f) -> f32 {
  return luma(sampleRgb(uv));
}

fn sampleLumaOff(uv: vec2f, off: vec2f, rcp: vec2f) -> f32 {
  return luma(sampleRgb(uv + off * rcp));
}

// Quality preset 39: 12 endpoint-search steps with the standard 3.11 step sizes.
const QUALITY = array<f32, 12>(1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0);

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let rcp = 1.0 / uniforms.resolution;
  let uv = in.vUv;

  let rgbM = sampleRgb(uv);
  let lumaM = luma(rgbM);

  // 3x3 neighborhood lumas.
  let lumaN = sampleLumaOff(uv, vec2f(0.0, -1.0), rcp);
  let lumaS = sampleLumaOff(uv, vec2f(0.0, 1.0), rcp);
  let lumaE = sampleLumaOff(uv, vec2f(1.0, 0.0), rcp);
  let lumaW = sampleLumaOff(uv, vec2f(-1.0, 0.0), rcp);

  let rangeMin = min(lumaM, min(min(lumaN, lumaS), min(lumaE, lumaW)));
  let rangeMax = max(lumaM, max(max(lumaN, lumaS), max(lumaE, lumaW)));
  let range = rangeMax - rangeMin;

  // Early out on low-contrast (interior) pixels.
  if (range < max(uniforms.edgeThresholdMin, rangeMax * uniforms.edgeThreshold)) {
    return vec4f(rgbM, 1.0);
  }

  // Corner lumas.
  let lumaNW = sampleLumaOff(uv, vec2f(-1.0, -1.0), rcp);
  let lumaNE = sampleLumaOff(uv, vec2f(1.0, -1.0), rcp);
  let lumaSW = sampleLumaOff(uv, vec2f(-1.0, 1.0), rcp);
  let lumaSE = sampleLumaOff(uv, vec2f(1.0, 1.0), rcp);

  let lumaNS = lumaN + lumaS;
  let lumaWE = lumaW + lumaE;
  let lumaNWNE = lumaNW + lumaNE;
  let lumaSWSE = lumaSW + lumaSE;
  let lumaNWSW = lumaNW + lumaSW;
  let lumaNESE = lumaNE + lumaSE;

  // Edge orientation: weighted gradient magnitude along each axis.
  let edgeHorz = abs(-2.0 * lumaW + lumaNWSW) + abs(-2.0 * lumaM + lumaNS) * 2.0 + abs(-2.0 * lumaE + lumaNESE);
  let edgeVert = abs(-2.0 * lumaN + lumaNWNE) + abs(-2.0 * lumaM + lumaWE) * 2.0 + abs(-2.0 * lumaS + lumaSWSE);
  let horzSpan = edgeHorz >= edgeVert;

  // Pick the two neighbors straddling the edge (perpendicular to it).
  var luma1 = select(lumaW, lumaN, horzSpan);
  var luma2 = select(lumaE, lumaS, horzSpan);
  let gradient1 = luma1 - lumaM;
  let gradient2 = luma2 - lumaM;
  let is1Steepest = abs(gradient1) >= abs(gradient2);
  let gradientScaled = 0.25 * max(abs(gradient1), abs(gradient2));

  // Step one texel toward the higher-contrast side.
  var stepLength = select(rcp.x, rcp.y, horzSpan);
  var lumaLocalAvg = 0.0;
  if (is1Steepest) {
    stepLength = -stepLength;
    lumaLocalAvg = 0.5 * (luma1 + lumaM);
  } else {
    lumaLocalAvg = 0.5 * (luma2 + lumaM);
  }

  // Shift uv half a texel onto the edge.
  var currentUv = uv;
  if (horzSpan) {
    currentUv.y = currentUv.y + stepLength * 0.5;
  } else {
    currentUv.x = currentUv.x + stepLength * 0.5;
  }

  // March along the edge in both directions until the local average diverges.
  let offset = select(vec2f(rcp.x, 0.0), vec2f(0.0, rcp.y), horzSpan);
  var uvA = currentUv - offset * QUALITY[0];
  var uvB = currentUv + offset * QUALITY[0];

  var lumaEndA = sampleLuma(uvA) - lumaLocalAvg;
  var lumaEndB = sampleLuma(uvB) - lumaLocalAvg;
  var doneA = abs(lumaEndA) >= gradientScaled;
  var doneB = abs(lumaEndB) >= gradientScaled;

  if (!doneA) {
    uvA = uvA - offset * QUALITY[1];
  }
  if (!doneB) {
    uvB = uvB + offset * QUALITY[1];
  }

  if (!(doneA && doneB)) {
    for (var i = 2; i < 12; i = i + 1) {
      if (!doneA) {
        lumaEndA = sampleLuma(uvA) - lumaLocalAvg;
      }
      if (!doneB) {
        lumaEndB = sampleLuma(uvB) - lumaLocalAvg;
      }
      doneA = abs(lumaEndA) >= gradientScaled;
      doneB = abs(lumaEndB) >= gradientScaled;

      if (!doneA) {
        uvA = uvA - offset * QUALITY[i];
      }
      if (!doneB) {
        uvB = uvB + offset * QUALITY[i];
      }
      if (doneA && doneB) {
        break;
      }
    }
  }

  // Distances to each endpoint, in pixels along the edge.
  var distA = select(uv.x - uvA.x, uv.y - uvA.y, horzSpan);
  var distB = select(uvB.x - uv.x, uvB.y - uv.y, horzSpan);
  let directionA = distA < distB;
  let distFinal = min(distA, distB);
  let edgeLength = distA + distB;
  let pixelOffset = -distFinal / edgeLength + 0.5;

  // Is the center pixel on the darker side of the edge? Only offset if the
  // nearest endpoint's luma variation matches.
  let isLumaMSmaller = lumaM < lumaLocalAvg;
  let lumaEndNearest = select(lumaEndB, lumaEndA, directionA);
  let correctVariation = (lumaEndNearest < 0.0) != isLumaMSmaller;
  let finalOffset = select(0.0, pixelOffset, correctVariation);

  // Subpixel offset from the full 3x3 low-pass, clamped and quadratically eased.
  let lumaAvg = (1.0 / 12.0) * (2.0 * (lumaNS + lumaWE) + lumaNWSW + lumaNESE);
  let subPixOffset1 = clamp(abs(lumaAvg - lumaM) / range, 0.0, 1.0);
  let subPixOffset2 = (-2.0 * subPixOffset1 + 3.0) * subPixOffset1 * subPixOffset1;
  let subPixOffsetFinal = subPixOffset2 * subPixOffset2 * uniforms.subpix;

  let pixelOffsetFinal = max(finalOffset, subPixOffsetFinal);

  var finalUv = uv;
  if (horzSpan) {
    finalUv.y = finalUv.y + pixelOffsetFinal * stepLength;
  } else {
    finalUv.x = finalUv.x + pixelOffsetFinal * stepLength;
  }

  return vec4f(sampleRgb(finalUv), 1.0);
}
