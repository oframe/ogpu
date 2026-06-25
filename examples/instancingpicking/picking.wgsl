// GPU picking via compute. The WebGL original read one pixel from an
// id-render target; with compute we cast a single ray against every instance's
// box and write a 0/1 hit flag the render pass reads back.
//
// Approachable variant: we ignore the per-instance rotation and test against an
// axis-aligned box at the instance offset (scale still applied). The hit volume
// no longer tracks the spinning cube exactly — good enough, and far simpler.

struct Uniforms {
  rayOrigin: vec3f,
  rayDir: vec3f,
  halfSize: f32, // cube half-extent in local space (size / 2)
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> offsets: array<vec4f>; // xyz = centre
@group(0) @binding(2) var<storage, read> randoms: array<vec4f>; // xyz used (y = scale)
@group(0) @binding(3) var<storage, read_write> hits: array<f32>;

// Ray vs axis-aligned box centred at origin, [-h, h]. Branchless slab test;
// min/max handle a zero direction component via signed infinities.
fn hitBox(ro: vec3f, rd: vec3f, h: f32) -> bool {
  let inv = 1.0 / rd;
  let t0 = (vec3f(-h) - ro) * inv;
  let t1 = (vec3f(h) - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let near = max(max(tmin.x, tmin.y), tmin.z);
  let far = min(min(tmax.x, tmax.y), tmax.z);
  return far >= max(near, 0.0);
}

@compute @workgroup_size(64, 1, 1)
fn pick(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&hits)) { return; }

  let off = offsets[i].xyz;
  let s = 0.9 + randoms[i].y * 0.2;

  // World ray -> instance-local box space, scale only (rotation ignored).
  let ro = (uniforms.rayOrigin - off) / s;
  let rd = uniforms.rayDir / s;

  hits[i] = select(0.0, 1.0, hitBox(ro, rd, uniforms.halfSize));
}
