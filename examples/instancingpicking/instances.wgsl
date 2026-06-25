struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
  time: f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
// Hit flags written by the picking compute pass — one f32 per instance.
@group(0) @binding(1) var<storage, read> hits : array<f32>;

struct Vertex {
  @builtin(instance_index) id: u32,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  // instanced attributes (xyz used; w is padding to match the storage layout)
  @location(3) offset: vec4f,
  @location(4) random: vec4f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
  @location(1) @interpolate(flat) vHit : f32,
}

fn rotate2d(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var out: VertexOutput;

  let offset = in.offset.xyz;
  let random = in.random.xyz;

  var pos = in.position;
  var nor = in.normal;

  pos *= 0.9 + random.y * 0.2;

  let a1 = random.x * 6.28 + 4.0 * uniforms.time * (random.y - 0.5);
  let a2 = random.z * 0.5 * sin(uniforms.time * random.x + random.z * 3.14);

  // rotate position around y (xz) then x (zy)
  let pxz = rotate2d(pos.xz, a1); pos.x = pxz.x; pos.z = pxz.y;
  let pzy = rotate2d(pos.zy, a2); pos.z = pzy.x; pos.y = pzy.y;

  // rotate the normal the same way for correct lighting
  let nxz = rotate2d(nor.xz, a1); nor.x = nxz.x; nor.z = nxz.y;
  let nzy = rotate2d(nor.zy, a2); nor.z = nzy.x; nor.y = nzy.y;

  pos += offset;

  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(pos, 1.0);
  out.vNormal = nor;
  out.vHit = hits[in.id];
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(in.vNormal);
  let lighting = dot(normal, normalize(vec3f(-0.3, 0.8, 0.6))) * 0.15 + 0.85;

  let original = vec3f(0.2, 0.8, 1.0) * lighting; // lit base colour
  let normals = normal * 0.5 + 0.5;               // normal visualisation
  let color = mix(original, normals, in.vHit);
  return vec4f(color, 1.0);
}
