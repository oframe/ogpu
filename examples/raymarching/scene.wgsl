// Raster scene shader for the raymarching example — post-composer MRT contract:
// linear-HDR color at @location(0), world-space normal at @location(1). No
// gamma here; the final pass owns the linear→sRGB boundary.

struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  uColor : vec3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
  @location(1) vWorldPos : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.vNormal = uniforms.normalMatrix * in.normal;
  out.vWorldPos = (uniforms.modelMatrix * vec4f(in.position, 1.0)).xyz;
  return out;
}

struct FragOut {
  @location(0) color : vec4f,
  @location(1) normal : vec4f,
}

@fragment
fn fs(in : VertexOutput) -> FragOut {
  let n = normalize(in.vNormal);
  let keyDir = normalize(vec3f(0.5, 0.8, 0.4));
  let key = max(dot(n, keyDir), 0.0) * 1.4;

  let sky = vec3f(0.35, 0.42, 0.55);
  let ground = vec3f(0.16, 0.14, 0.12);
  let hemi = mix(ground, sky, n.y * 0.5 + 0.5);

  let viewDir = normalize(uniforms.cameraPosition - in.vWorldPos);
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.35;

  let col = uniforms.uColor * (key + hemi) + vec3f(rim) * uniforms.uColor;

  var out : FragOut;
  out.color = vec4f(col, 1.0);
  out.normal = vec4f(n, 1.0);
  return out;
}
