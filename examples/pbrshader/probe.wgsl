// Debug probe spheres for the PBR example. Two display modes selected by
// `uniforms.mode`: 0 = SH irradiance evaluated at the surface normal (the
// diffuse environment), 1 = the prefiltered specular cube sampled by the
// view reflection (a mirror of the environment). Shares the IBL resources
// bound by the main pbr shader.

struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition : vec3f,
  mode : f32, // 0 = SH irradiance, 1 = specular cube
}

struct SHConstants {
  coefficients: array<vec4f, 9>
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var tSpecular : texture_cube<f32>;
@group(0) @binding(2) var<uniform> shConstants : SHConstants;
@group(0) @binding(3) var iblSampler : sampler;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
  @location(1) vWorldPos : vec3f,
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var vsOut : VertexOutput;
  let worldPos = uniforms.modelMatrix * vec4f(v.position, 1.0);
  vsOut.vWorldPos = worldPos.xyz;
  vsOut.position = uniforms.projectionMatrix * uniforms.viewMatrix * worldPos;
  vsOut.vNormal = normalize(uniforms.normalMatrix * v.normal);
  return vsOut;
}

fn filmic(x : vec3f) -> vec3f {
  let X = max(vec3f(0.0), x - vec3f(0.004));
  let result = (X * (vec3f(6.2) * X + vec3f(0.5))) /
               (X * (vec3f(6.2) * X + vec3f(1.7)) + vec3f(0.06));
  return pow(result, vec3f(2.2));
}

fn evaluateSH(normal : vec3f, c : array<vec4f, 9>) -> vec3f {
  return c[0].xyz +
    c[1].xyz * normal.y +
    c[2].xyz * normal.z +
    c[3].xyz * normal.x +
    c[4].xyz * (normal.y * normal.x) +
    c[5].xyz * (normal.y * normal.z) +
    c[6].xyz * (3.0 * normal.z * normal.z - 1.0) +
    c[7].xyz * (normal.x * normal.z) +
    c[8].xyz * (normal.x * normal.x - normal.y * normal.y);
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  let normal = normalize(in.vNormal);
  var col : vec3f;

  if (uniforms.mode < 0.5) {
    // SH irradiance (already scaled by PI)
    col = max(evaluateSH(normal, shConstants.coefficients), vec3f(0.0, 0.0, 0.0));
  } else {
    // prefiltered specular cube, mirror reflection at the lowest mip
    let v = normalize(uniforms.cameraPosition - in.vWorldPos);
    let r = reflect(-v, normal);
    col = textureSampleLevel(tSpecular, iblSampler, r, 0.0).xyz;
  }

  col = filmic(col);
  col = pow(col, vec3(1.0 / 2.2));
  return vec4f(col, 1.0);
}
