struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  normalMatrix : mat3x3f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vNormal : vec3f,
  @location(1) vMVPos : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
  var vsOut: VertexOutput;
  vsOut.vNormal = normalize(uniforms.normalMatrix * in.normal);
  let mvPos = uniforms.modelViewMatrix * vec4f(in.position, 1.0);
  vsOut.vMVPos = mvPos.xyz;
  vsOut.position = uniforms.projectionMatrix * mvPos;
  return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(in.vNormal);
  let lighting = dot(normal, normalize(vec3f(-0.3, 0.8, 0.6)));
  var color = vec3f(1.0, 0.5, 0.2) * (1.0 - 0.5 * lighting) + in.vMVPos.xzy * 0.1;

  let dist = length(in.vMVPos);
  let fog = smoothstep(4.0, 10.0, dist);
  color = mix(color, vec3f(1.0), fog);

  return vec4f(color, 1.0);
}
