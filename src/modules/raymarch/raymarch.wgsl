// SDF raymarcher drawn as scene content (fullscreen triangle through a Mesh).
// Rays derive from the live (jittered) projection/view matrices so TAA stays
// consistent; hits write @builtin(frag_depth) (projected hit depth) so raster
// geometry occludes and is occluded correctly. Miss pixels discard, leaving the
// raster scene untouched.
//
// Outputs follow the post-composer MRT contract: @location(0) linear HDR color,
// @location(1) world-space normal. Lines tagged `//! mrt` are stripped by
// Raymarcher.js for the plain-swapchain path (single color target).

struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  inverseProjectionMatrix : mat4x4f,
  inverseViewMatrix : mat4x4f,
  // 8 materials x 2 vec4s: [rgb = base color, a = roughness],
  //                        [x = metallic, y = reflectivity, zw = unused]
  materials : array<vec4f, 16>,
  cameraPosition : vec3f,
  primitiveCount : u32,
  resolution : vec2f,
  cameraFar : f32,
  envIntensity : f32,
  bounce : u32,
}

struct Primitive {
  invTransform : mat4x4f,
  params : vec4f,
  kind : u32,       // 0 sphere, 1 box, 2 torus, 3 capsule, 4 plane
  blendK : f32,     // smooth-min blend radius vs the primitives before it (0 = hard union)
  materialId : u32,
  scale : f32,      // min axis scale — rescales local distance back to world (conservative)
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> primitives : array<Primitive>;
@group(0) @binding(2) var tSpecular : texture_cube<f32>;
@group(0) @binding(3) var iblSampler : sampler;

// Sphere-trace step cap. Tiered by PerformanceProfile (40/64/96/128).
override maxSteps : i32 = 96;
// Mip count of the prefiltered specular cube (same contract as pbr.wgsl):
// roughness in [0,1] maps to lod [0, roughnessLevels - 1].
override roughnessLevels : f32 = 6.0;
// 1 = tonemap + gamma in this shader (plain-swapchain path, no FinalPass after).
override tonemap : u32 = 0u;

struct VertexInput {
  @location(0) position : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
}

@vertex
fn vs(in : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  // fullscreen covering triangle — positions are already clip-space
  out.position = vec4f(in.position.xy, 0.0, 1.0);
  return out;
}

// ── SDF primitives (local space) ────────────────────────────────────────────

fn sdSphere(p : vec3f, r : f32) -> f32 {
  return length(p) - r;
}

fn sdBox(p : vec3f, b : vec3f, r : f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdTorus(p : vec3f, radii : vec2f) -> f32 {
  let q = vec2f(length(p.xz) - radii.x, p.y);
  return length(q) - radii.y;
}

fn sdCapsule(p : vec3f, halfHeight : f32, r : f32) -> f32 {
  let q = vec3f(p.x, p.y - clamp(p.y, -halfHeight, halfHeight), p.z);
  return length(q) - r;
}

fn sdPlane(p : vec3f) -> f32 {
  return p.y;
}

fn primDist(i : u32, p : vec3f) -> f32 {
  let prim = primitives[i];
  let q = (prim.invTransform * vec4f(p, 1.0)).xyz;
  var d = 1e9;
  switch prim.kind {
    case 0u: { d = sdSphere(q, prim.params.x); }
    case 1u: { d = sdBox(q, prim.params.xyz, prim.params.w); }
    case 2u: { d = sdTorus(q, prim.params.xy); }
    case 3u: { d = sdCapsule(q, prim.params.x, prim.params.y); }
    case 4u: { d = sdPlane(q); }
    default: {}
  }
  return d * prim.scale;
}

// Polynomial smooth min (Quilez). k = blend radius.
fn smin(a : f32, b : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Scene distance: left-fold over the primitive list; each primitive's blendK
// blends it against the accumulated field (morphing = animating blendK/params
// /transforms from JS per frame).
fn map(p : vec3f) -> f32 {
  var d = 1e9;
  for (var i = 0u; i < uniforms.primitiveCount; i++) {
    let di = primDist(i, p);
    let k = primitives[i].blendK;
    if (k > 0.0) {
      d = smin(d, di, k);
    } else {
      d = min(d, di);
    }
  }
  return d;
}

// Material of the closest primitive (evaluated once at the hit point; color
// pops at the exact blend midpoint — acceptable v1).
fn mapMaterial(p : vec3f) -> u32 {
  var best = 1e9;
  var mat = 0u;
  for (var i = 0u; i < uniforms.primitiveCount; i++) {
    let di = primDist(i, p);
    if (di < best) {
      best = di;
      mat = primitives[i].materialId;
    }
  }
  return min(mat, 7u);
}

// ── Sphere tracing ──────────────────────────────────────────────────────────

// Distance-scaled epsilon: ~one pixel of angular error at distance t.
// projectionMatrix[1][1] = 1 / tan(fov / 2).
fn pixelEps(t : f32) -> f32 {
  return max(1e-4, (t * 2.0) / (uniforms.projectionMatrix[1][1] * uniforms.resolution.y));
}

fn march(ro : vec3f, rd : vec3f, tMax : f32) -> f32 {
  var t = 1e-3;
  for (var i = 0; i < maxSteps; i++) {
    let d = map(ro + rd * t);
    if (d < pixelEps(t)) {
      return t;
    }
    t += d;
    if (t > tMax) {
      break;
    }
  }
  return -1.0;
}

// Tetrahedron-gradient normal (4 field taps).
fn calcNormal(p : vec3f, eps : f32) -> vec3f {
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * eps) +
    k.yyx * map(p + k.yyx * eps) +
    k.yxy * map(p + k.yxy * eps) +
    k.xxx * map(p + k.xxx * eps));
}

// 5-tap SDF ambient occlusion along the normal.
fn calcAO(p : vec3f, n : vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 0; i < 5; i++) {
    let h = 0.01 + 0.13 * f32(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.8;
  }
  return clamp(1.0 - 1.8 * occ, 0.0, 1.0);
}

// ── Shading ─────────────────────────────────────────────────────────────────

fn envSpecular(r : vec3f, roughness : f32) -> vec3f {
  return textureSampleLevel(tSpecular, iblSampler, r, roughness * (roughnessLevels - 1.0)).rgb * uniforms.envIntensity;
}

// Highest mip of the prefiltered cube as a cheap irradiance approximation.
fn envIrradiance(n : vec3f) -> vec3f {
  return textureSampleLevel(tSpecular, iblSampler, n, roughnessLevels - 1.0).rgb * uniforms.envIntensity;
}

fn shade(p : vec3f, n : vec3f, v : vec3f, matId : u32, ao : f32) -> vec3f {
  let base = uniforms.materials[matId * 2u];
  let props = uniforms.materials[matId * 2u + 1u];
  let albedo = base.rgb;
  let roughness = clamp(base.a, 0.04, 1.0);
  let metallic = props.x;

  let f0 = mix(vec3f(0.04), albedo, metallic);
  let nDotV = max(dot(n, v), 0.0);
  let f = f0 + (max(vec3f(1.0 - roughness), f0) - f0) * pow(1.0 - nDotV, 5.0);
  let kD = (1.0 - f) * (1.0 - metallic);

  let r = reflect(-v, n);
  var col = kD * albedo * envIrradiance(n) + f * envSpecular(r, roughness);

  // key light for shape definition (matches the raster scene shader's key)
  let keyDir = normalize(vec3f(0.5, 0.8, 0.4));
  col += albedo * max(dot(n, keyDir), 0.0) * 0.35;

  return col * ao;
}

// ── Fragment ────────────────────────────────────────────────────────────────

struct FragOut {
  @builtin(frag_depth) depth : f32,
  @location(0) color : vec4f,
  @location(1) normal : vec4f, //! mrt
}

@fragment
fn fs(in : VertexOutput) -> FragOut {
  // frag coord is y-down; ndc is y-up — flip when unprojecting.
  let uv = in.position.xy / uniforms.resolution;
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, 1.0, 1.0);
  var vp = uniforms.inverseProjectionMatrix * ndc;
  vp = vp / vp.w;
  let farPoint = uniforms.inverseViewMatrix * vec4f(vp.xyz, 1.0);

  let ro = uniforms.cameraPosition;
  let rd = normalize(farPoint.xyz - ro);

  let t = march(ro, rd, uniforms.cameraFar);
  if (t < 0.0) {
    discard;
  }

  let p = ro + rd * t;
  let eps = pixelEps(t);
  let n = calcNormal(p, max(eps, 2e-4) * 2.0);
  let ao = calcAO(p, n);
  let matId = mapMaterial(p);

  var col = shade(p, n, -rd, matId, ao);

  // optional single reflection bounce for reflective materials (tier-gated)
  let base = uniforms.materials[matId * 2u];
  let reflectivity = uniforms.materials[matId * 2u + 1u].y;
  if (uniforms.bounce == 1u && reflectivity > 0.01) {
    let r = reflect(rd, n);
    let ro2 = p + n * max(eps, 2e-4) * 4.0;
    var refl = envSpecular(r, base.a);
    let t2 = march(ro2, r, uniforms.cameraFar * 0.5);
    if (t2 > 0.0) {
      let p2 = ro2 + r * t2;
      let n2 = calcNormal(p2, max(pixelEps(t + t2), 2e-4) * 2.0);
      refl = shade(p2, n2, -r, mapMaterial(p2), calcAO(p2, n2));
    }
    col = mix(col, refl, reflectivity * (1.0 - clamp(base.a, 0.04, 1.0)));
  }

  // Projected hit depth through the same (jittered) matrices the raster scene
  // uses — this is what makes two-way occlusion exact.
  let clip = uniforms.projectionMatrix * uniforms.viewMatrix * vec4f(p, 1.0);

  var out : FragOut;
  out.depth = clamp(clip.z / clip.w, 0.0, 1.0);
  if (tonemap == 1u) {
    col = pow(col / (col + vec3f(1.0)), vec3f(1.0 / 2.2));
  }
  out.color = vec4f(col, 1.0);
  out.normal = vec4f(n, 1.0); //! mrt
  return out;
}
