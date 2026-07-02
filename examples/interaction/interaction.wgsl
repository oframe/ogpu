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
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;
  let worldPos = uniforms.modelMatrix * vec4f(in.position, 1.0);
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  out.vNormal = uniforms.normalMatrix * in.normal;
  out.vWorldPos = worldPos.xyz;
  return out;
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.vNormal);
  let keyDir = normalize(vec3f(0.5, 0.8, 0.4));
  let key = max(dot(n, keyDir), 0.0);
  let hemi = mix(vec3f(0.18, 0.16, 0.15), vec3f(0.4, 0.45, 0.55), n.y * 0.5 + 0.5);
  let viewDir = normalize(uniforms.cameraPosition - in.vWorldPos);
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.25;

  let col = uniforms.uColor * (key + hemi) + vec3f(rim) * uniforms.uColor;
  return vec4f(linearToSrgb(col), 1.0);
}
