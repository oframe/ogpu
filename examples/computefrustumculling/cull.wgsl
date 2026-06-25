// Frustum cull pass. One thread per instance: test the tree's precomputed
// world-space bounding sphere against the demo camera's 6 planes; survivors
// atomic-append their index into `visible` and bump the indirect draw's
// instanceCount. The trees never move, so the spheres are baked once on the CPU.

struct CullUniforms {
  planes : array<vec4f, 6>, // xyz = plane normal, w = plane constant
  count  : u32,             // total instance count
};

// drawIndirect args (forest model is non-indexed). Only instanceCount is mutated
// here (atomically).
struct DrawArgs {
  vertexCount   : u32,
  instanceCount : atomic<u32>,
  firstVertex   : u32,
  firstInstance : u32,
};

@group(0) @binding(0) var<uniform> u : CullUniforms;
@group(0) @binding(1) var<storage, read> spheres : array<vec4f>; // xyz=center, w=radius
@group(0) @binding(2) var<storage, read_write> visible : array<u32>;
@group(0) @binding(3) var<storage, read_write> args : DrawArgs;

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }

  let s = spheres[i];
  let center = s.xyz;
  let radius = s.w;

  // outside if the sphere is fully behind any plane.
  for (var p = 0u; p < 6u; p = p + 1u) {
    let pl = u.planes[p];
    if (dot(pl.xyz, center) + pl.w < -radius) { return; }
  }

  let slot = atomicAdd(&args.instanceCount, 1u);
  visible[slot] = i;
}
