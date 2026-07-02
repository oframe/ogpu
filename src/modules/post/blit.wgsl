// Passthrough blit. Post-chain uv convention: vs flips uv.y so texture space
// ((0,0) = top-left) lands in vUv and every chained pass stays
// orientation-preserving.

@group(0) @binding(0) var blitSampler: sampler;
@group(0) @binding(1) var tMap: texture_2d<f32>;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) vUv: vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(in.position, 1.0);
  out.vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return textureSample(tMap, blitSampler, in.vUv);
}
