// Textured forest model — port of the OGL frustum-culling field shader. Samples
// forest.jpg by uv, then fades toward white with distance fog + a ground mist on
// the lower verts (exact OGL formulas).

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var textureSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vMVPos : vec3f,
  @location(2) vPos : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  let mvPos = uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = uniforms.projectionMatrix * mvPos;
  out.vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  out.vMVPos = mvPos.xyz;
  out.vPos = in.position;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  var tex = textureSample(tMap, textureSampler, in.vUv).rgb;

  // distance fog toward white (OGL: smoothstep(2,15) * 0.8)
  let dist = length(in.vMVPos);
  let fog = smoothstep(2.0, 15.0, dist);
  tex = mix(tex, vec3f(1.0), fog * 0.8);

  // ground mist toward white (OGL: mix(tex, white, smoothstep(1,0, vPos.y)))
  tex = mix(tex, vec3f(1.0), smoothstep(1.0, 0.0, in.vPos.y));

  return vec4f(tex, 1.0);
}
