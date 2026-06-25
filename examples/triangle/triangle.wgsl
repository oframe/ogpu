// Fullscreen-triangle screen shader — port of OGL's triangle-screen-shader.
// Animated cos() color ramp over the screen uv. No camera uniforms needed.

struct Uniforms {
    uColor: vec3f,
    time: f32,
    resolution: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs(in: Vertex) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4f(in.position, 1.0);
    out.uv = in.uv;
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let rgb = 0.5 + 0.3 * cos(vec3f(in.uv.x, in.uv.y, in.uv.x) + uniforms.time) + uniforms.uColor;
    return vec4f(rgb, 1.0);
}
