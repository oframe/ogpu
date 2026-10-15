// validate-prepend: ../../core/engine.wgsl
// MSDF/MTSDF glyph quads, one instance per glyph, with a SplitText-style reveal
// evaluated per glyph: every unit (char/word/line) runs the same tween from a "from"
// state to rest, offset in time by its stagger order. Units of the same word/line share
// a box, so they move as one.

struct Uniforms {
  uColor: vec4f,
  uOutlineColor: vec4f,
  uOffset: vec3f,          // world units
  uOutline: f32,           // em
  uRotation: vec3f,        // radians, applied z * y * x about the unit's origin
  uOpacity: f32,
  uScale: vec3f,
  uBlur: f32,              // em
  uCounts: vec3f,          // chars, words, lines
  uTimeline: f32,          // seconds into the reveal
  uOffsetPercent: vec2f,   // fraction of the unit's own box, like gsap x/yPercent
  uOrigin: vec2f,          // pivot inside the unit box, 0..1
  uWipe: vec2f,            // clip reveal direction (0 = off)
  uWipeSoftness: f32,      // fraction of the unit box
  uDuration: f32,
  uStagger: f32,
  uPxRange: f32,
  uEmPx: f32,
  uStaggerBy: u32,         // 0 chars, 1 words, 2 lines
  uMaskBy: u32,            // 0 off, 1 chars, 2 words, 3 lines
  uOrder: u32,             // 0 start, 1 end, 2 center, 3 edges, 4 random
  uEase: u32,
  uSeed: u32,
  uEm: f32,                // world units per em (the layout size)
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var atlasSampler: sampler;
@group(0) @binding(2) var tMap: texture_2d<f32>;

const PI = 3.14159265;

struct Vertex {
  @location(0) position: vec2f, // quad corner, 0..1
  @location(1) rect: vec4f,     // glyph quad, layout space
  @location(2) atlas: vec4f,    // uv at the quad's bottom-left, top-right
  @location(3) ids: vec4f,      // char, word, line
  @location(4) charBox: vec4f,
  @location(5) wordBox: vec4f,
  @location(6) lineBox: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,                         // animated, layout space
  @location(2) unitUv: vec2f,                        // rest position inside the unit box
  @location(3) @interpolate(flat) maskBox: vec4f,
  @location(4) @interpolate(flat) anim: vec3f,       // eased t, opacity, blur
}

fn pick4(a: vec4f, b: vec4f, c: vec4f, i: u32) -> vec4f {
  return select(select(a, b, i == 1u), c, i == 2u);
}

fn pick1(a: f32, b: f32, c: f32, i: u32) -> f32 {
  return select(select(a, b, i == 1u), c, i == 2u);
}

fn rand(i: u32) -> f32 {
  let state = (i * 747796405u) + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return f32((word >> 22u) ^ word) / 4294967295.0;
}

fn unitOrder(i: f32, n: f32) -> f32 {
  let last = max(n - 1.0, 0.0);
  let mid = last * 0.5;
  let mode = uniforms.uOrder;
  if (mode == 1u) { return last - i; }
  if (mode == 2u) { return abs(i - mid); }
  if (mode == 3u) { return mid - abs(i - mid); }
  if (mode == 4u) { return rand(u32(i) + (uniforms.uSeed * 9781u)) * last; }
  return i;
}

// gsap names: power1 = quad, power2 = cubic, power3 = quart, power4 = quint
fn ease(t: f32, id: u32) -> f32 {
  let u = 1.0 - t;
  if (id == 1u) { return 1.0 - (u * u); }
  if (id == 2u) { return 1.0 - (u * u * u); }
  if (id == 3u) { return 1.0 - (u * u * u * u); }
  if (id == 4u) { return 1.0 - (u * u * u * u * u); }
  if (id == 5u) { return select(1.0 - exp2(-10.0 * t), 1.0, t >= 1.0); }
  if (id == 6u) {
    // back.out(1.7); no pow() — a negative base is NaN in WGSL
    let c1 = 1.70158;
    return 1.0 + ((c1 + 1.0) * (-u * u * u)) + (c1 * (u * u));
  }
  if (id == 7u) { return sin(t * PI * 0.5); }
  if (id == 8u) { return sqrt(1.0 - (u * u)); }
  if (id == 9u) {
    let v = (-2.0 * t) + 2.0;
    return select(1.0 - (v * v * v * v * 0.5), 8.0 * t * t * t * t, t < 0.5);
  }
  if (id == 10u) {
    let lo = exp2((20.0 * t) - 10.0) * 0.5;
    let hi = (2.0 - exp2((-20.0 * t) + 10.0)) * 0.5;
    return clamp(select(hi, lo, t < 0.5), 0.0, 1.0);
  }
  if (id == 11u) {
    let e = (exp2(-10.0 * t) * sin(((t * 10.0) - 0.75) * (2.0 * PI / 3.0))) + 1.0;
    return select(select(e, 1.0, t >= 1.0), 0.0, t <= 0.0);
  }
  return t;
}

fn rotation(r: vec3f) -> mat3x3f {
  let c = cos(r);
  let s = sin(r);
  let rx = mat3x3f(1.0, 0.0, 0.0, 0.0, c.x, s.x, 0.0, -s.x, c.x);
  let ry = mat3x3f(c.y, 0.0, -s.y, 0.0, 1.0, 0.0, s.y, 0.0, c.y);
  let rz = mat3x3f(c.z, s.z, 0.0, -s.z, c.z, 0.0, 0.0, 0.0, 1.0);
  return rz * ry * rx;
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;

  let by = uniforms.uStaggerBy;
  let unitBox = pick4(in.charBox, in.wordBox, in.lineBox, by);
  let index = pick1(in.ids.x, in.ids.y, in.ids.z, by);
  let count = pick1(uniforms.uCounts.x, uniforms.uCounts.y, uniforms.uCounts.z, by);

  let order = unitOrder(index, count);
  let local = clamp((uniforms.uTimeline - (order * uniforms.uStagger)) / max(uniforms.uDuration, 1e-5), 0.0, 1.0);
  let e = ease(local, uniforms.uEase);
  let k = 1.0 - e; // weight of the "from" state

  let p = mix(in.rect.xy, in.rect.zw, in.position);
  let size = unitBox.zw - unitBox.xy;
  let pivot = vec3f(unitBox.xy + (size * uniforms.uOrigin), 0.0);
  let offset = (uniforms.uOffset + vec3f(uniforms.uOffsetPercent * size, 0.0)) * k;
  let scale = mix(uniforms.uScale, vec3f(1.0), e);
  let animated = pivot + (rotation(uniforms.uRotation * k) * ((vec3f(p, 0.0) - pivot) * scale)) + offset;

  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(animated, 1.0)));
  out.uv = mix(in.atlas.xy, in.atlas.zw, in.position);
  out.local = animated.xy;
  out.unitUv = (p - unitBox.xy) / max(size, vec2f(1e-6));

  // boxes hug the ink; grow by the outline so a glyph at rest is never clipped
  let maskBy = uniforms.uMaskBy;
  let grow = vec4f(-1.0, -1.0, 1.0, 1.0) * (uniforms.uOutline * uniforms.uEm);
  out.maskBox = select(
    pick4(in.charBox, in.wordBox, in.lineBox, max(maskBy, 1u) - 1u) + grow,
    vec4f(-1e6, -1e6, 1e6, 1e6),
    maskBy == 0u
  );
  out.anim = vec3f(e, mix(uniforms.uOpacity, 1.0, e), uniforms.uBlur * k);
  return out;
}

fn median(r: f32, g: f32, b: f32) -> f32 {
  return max(min(r, g), min(max(r, g), b));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  // derivatives + the sample stay in uniform control flow — every effect below is a
  // multiplier, never a branch around them
  let texel = textureSample(tMap, atlasSampler, in.uv);
  let unitRange = vec2f(uniforms.uPxRange) / vec2f(textureDimensions(tMap, 0));
  let screenPxRange = max(0.5 * dot(unitRange, vec2f(1.0) / fwidth(in.uv)), 1.0);
  let pxPerEm = screenPxRange * uniforms.uEmPx / uniforms.uPxRange;

  // msdf keeps corners sharp at rest; once blurred the true sdf (alpha) takes over, the
  // median goes lumpy away from the edge
  let blurPx = in.anim.z * pxPerEm;
  let ramp = 1.0 + blurPx;
  let msd = median(texel.r, texel.g, texel.b) - 0.5;
  let sd = texel.a - 0.5;
  let fillDist = mix(msd, sd, clamp(blurPx * 0.5, 0.0, 1.0)) * screenPxRange;
  let fill = clamp((fillDist / ramp) + 0.5, 0.0, 1.0);

  let outlinePx = uniforms.uOutline * pxPerEm;
  let ring = clamp((((sd * screenPxRange) + outlinePx) / ramp) + 0.5, 0.0, 1.0);
  let fillA = fill * uniforms.uColor.a;
  let ringA = select(0.0, ring * uniforms.uOutlineColor.a, uniforms.uOutline > 0.0) * (1.0 - fillA);
  let alpha = fillA + ringA;
  let rgb = ((uniforms.uColor.rgb * fillA) + (uniforms.uOutlineColor.rgb * ringA)) / max(alpha, 1e-5);

  // overflow-hidden mask in layout space: the glyph moves, the box doesn't
  let mb = in.maskBox;
  let edge = min(min(in.local.x - mb.x, mb.z - in.local.x), min(in.local.y - mb.y, mb.w - in.local.y));
  let mask = clamp((edge / max(fwidth(edge), 1e-6)) + 0.5, 0.0, 1.0);

  // clip-path wipe in the unit's own box, eased t is how much of it is revealed
  let dir = uniforms.uWipe;
  let span = abs(dir.x) + abs(dir.y);
  let along = (dot(in.unitUv, dir) + max(-dir.x, 0.0) + max(-dir.y, 0.0)) / max(span, 1e-5);
  let soft = max(uniforms.uWipeSoftness, 1e-4);
  let front = in.anim.x * (1.0 + soft);
  let wipe = select(1.0, 1.0 - smoothstep(front - soft, front, along), span > 0.0);

  return vec4f(rgb, alpha * in.anim.y * mask * wipe);
}
