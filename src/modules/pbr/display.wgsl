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

struct Vertex {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs(v: Vertex) -> VertexOutput {

    var vsOut: VertexOutput;

    vsOut.position = vec4f(v.position, 1.0);
    vsOut.uv = v.uv;
    return vsOut;

}

//https://mattlockyer.github.io/iat455/documents/rgb-hsv.pdf
fn RGBToHSV(rgb: vec3f) -> vec3f {

    let cmax = max(max(rgb.r, rgb.g), rgb.b);
    let cmin = min(min(rgb.r, rgb.g), rgb.b);
    let delta = cmax - cmin;
    
    var h: f32 = 0.0;
    
    if (delta != 0.0) {
        if (cmax == rgb.r) {
            h = (rgb.g - rgb.b) / delta;
            if (h < 0.0) { h += 6.0; }
        } else if (cmax == rgb.g) {
            h = ((rgb.b - rgb.r) / delta) + 2.0;
        } else { // cmax == rgb.b
            h = ((rgb.r - rgb.g) / delta) + 4.0;
        }
        h = h / 6.0;
    }
    
    let s: f32 = select(0.0, delta / cmax, cmax != 0.0);
    let v: f32 = cmax;
    
    return vec3f(h, s, v);
    
}

fn HSVToRGB(hsv: vec3f) -> vec3f {

    let h = hsv.x;
    let s = hsv.y;
    let v = hsv.z;

    let c = v * s;
    let x = c * (1.0 - abs(fract(h * 6.0) - 3.0 - 1.0));
    let m = v - c;
    
    var rgb: vec3f;
    
    if (h < 1.0/6.0) {
        rgb = vec3f(c, x, 0.0);
    } else if (h < 2.0/6.0) {
        rgb = vec3f(x, c, 0.0);
    } else if (h < 3.0/6.0) {
        rgb = vec3f(0.0, c, x);
    } else if (h < 4.0/6.0) {
        rgb = vec3f(0.0, x, c);
    } else if (h < 5.0/6.0) {
        rgb = vec3f(x, 0.0, c);
    } else {
        rgb = vec3f(c, 0.0, x);
    }
    
    return rgb + m;
    
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    
    let resolution = uniforms.resolution;
    let uv = vec2f(in.uv.x, 1.0 - in.uv.y);
    let col = textureSample(map, sampler2d, uv).xyz;

    let outputCol = col;

    return vec4f(outputCol, 1.0);
}