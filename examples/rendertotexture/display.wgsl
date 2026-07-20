struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var sampler2d: sampler;
@group(0) @binding(2) var map: texture_2d<f32>;
@group(0) @binding(3) var normals: texture_2d<f32>;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) uv : vec2f,
}

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs(v : Vertex) -> VertexOutput {
    var vsOut: VertexOutput;
    vsOut.position = vec4f(v.position, 1.0);
    vsOut.uv = v.uv;
    return vsOut;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    
    let resolution = uniforms.resolution;
    let uv = vec2f(in.uv.x, 1.0 - in.uv.y);
    let col = textureSample(map, sampler2d, uv).xyz;
    let norm = textureSample(normals, sampler2d, uv).xyz;

    var outputCol = mix(col, norm, step(0.5, uv.x));
    return vec4f(outputCol, 1.0);
}