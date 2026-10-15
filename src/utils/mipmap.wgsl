// Box-filter mip downsample: samples one source mip with a linear sampler
// (exact 2x ratio = 2x2 average). Source/target are single-layer 2d views.

@group(0) @binding(0) var mipSampler: sampler;
@group(0) @binding(1) var tSource: texture_2d<f32>;

struct Vertex {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vUv: vec2f,
}

@vertex
fn vs(v: Vertex) -> VertexOutput {
    var o: VertexOutput;
    o.position = vec4f(v.position, 1.0);
    // fullscreen uv has v up; texture rows run down
    o.vUv = vec2f(v.uv.x, 1.0 - v.uv.y);
    return o;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    return textureSample(tSource, mipSampler, in.vUv);
}
