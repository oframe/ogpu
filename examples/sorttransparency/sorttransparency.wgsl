struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  resolution : vec2f,
  time : f32,
  color : vec3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var textureSampler : sampler;
@group(0) @binding(2) var tMap : texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vMVPos : vec4f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;

  // bulge the plane along its normal axis based on radial uv distance
  var pos = in.position;
  let dist = pow(length(in.uv - 0.5), 2.0) - 0.25;
  pos.y += dist * 0.5;

  let mvPos = uniforms.modelViewMatrix * vec4f(pos, 1.0);
  out.vMVPos = mvPos;
  out.position = uniforms.projectionMatrix * mvPos;
  out.vUv = in.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  // leaf cutout alpha comes from the texture's green channel (matches OGL)
  let alpha = textureSample(tMap, textureSampler, in.vUv).g;

  var color = uniforms.color + in.vMVPos.xzy * 0.05;

  // distance fog toward white
  let d = length(in.vMVPos.xyz);
  let fog = smoothstep(5.0, 10.0, d);
  color = mix(color, vec3f(1.0), fog);

  if (alpha < 0.01) {
    discard;
  }

  return vec4f(color, alpha);
}
