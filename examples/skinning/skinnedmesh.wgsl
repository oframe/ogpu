struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  modelMatrix: mat4x4f,
  normalMatrix : mat3x3f,
  cameraPosition: vec3f,
  resolution: vec2f,
  uScale: f32,
  uAlpha: f32
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> positionBuffer : array<f32>;
@group(0) @binding(2) var<storage, read> normalBuffer : array<f32>;
@group(0) @binding(3) var textureSampler : sampler;
@group(0) @binding(4) var tMap : texture_2d<f32>;

struct Vertex {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @builtin(vertex_index) vertexIndex: u32,
}

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) vUv : vec2f,
    @location(1) vNormal : vec3f,
    @location(2) vWorldPos : vec3f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {

    var vsOut: VertexOutput;

    let position = vec3f(
        positionBuffer[in.vertexIndex * 3],
        positionBuffer[in.vertexIndex * 3 + 1],
        positionBuffer[in.vertexIndex * 3 + 2]
    );
    let normal = vec3f(
        normalBuffer[in.vertexIndex * 3],
        normalBuffer[in.vertexIndex * 3 + 1],
        normalBuffer[in.vertexIndex * 3 + 2]
    );

    let worldPosition = uniforms.modelMatrix * vec4f(position, 1.0);
    let viewPosition = uniforms.viewMatrix * worldPosition;
    let clipPosition = uniforms.projectionMatrix * viewPosition;

    vsOut.position = clipPosition;
    vsOut.vUv = vec2f(in.uv.x, 1.0 - in.uv.y); //y is flipped in WebGPU
    vsOut.vNormal = normalize(normal);
    vsOut.vWorldPos = worldPosition.xyz;
    return vsOut;
}

struct FragmentOutput {
    @location(0) color: vec4f,
}

@fragment
fn fs(in: VertexOutput) -> FragmentOutput {
    let tex = textureSample(tMap, textureSampler, in.vUv).rgb;
    let normal = normalize(in.vNormal);

    let light = vec3f(0.0, 1.0, 0.0);
    let shading = min(0.0, dot(normal, light) * 0.2);

    var fragColor: FragmentOutput;
    fragColor.color = vec4f(tex + shading, 1.0);
    return fragColor;
}