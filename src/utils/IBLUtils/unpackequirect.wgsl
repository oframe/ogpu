enable f16;

const INV_PI = 0.31830988618;
const INV_TWO_PI = 0.15915494309;

struct Uniforms {
    resolution: f32,
    faceIndex: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var map: texture_2d<f32>;
@group(0) @binding(2) var outTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var texSampler: sampler;

fn equirectUV(dir: vec3f) -> vec2f {
    let d = normalize(dir);
    let u = 0.5 + atan2(d.x, d.z) * INV_TWO_PI;
    let v = 0.5 - asin(d.y) * INV_PI;
    return vec2f(u, v);
}

fn cubeFaceDir(face: u32, s: f32, t: f32) -> vec3f {
    switch face {
        case 0u: { return vec3f( 1.0, -t, -s); }
        case 1u: { return vec3f(-1.0, -t,  s); }
        case 2u: { return vec3f( s,  1.0,  t); }
        case 3u: { return vec3f( s, -1.0, -t); }
        case 4u: { return vec3f( s, -t,  1.0); }
        default: { return vec3f(-s, -t, -1.0); }
    }
}

@compute @workgroup_size(1, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3u,
) {
    let uv = (vec2f(global_id.xy) + 0.5) / uniforms.resolution;
    let s = 2.0 * uv.x - 1.0;
    let t = 2.0 * uv.y - 1.0;
    let dir = normalize(cubeFaceDir(uniforms.faceIndex, s, t));

    let color = textureSampleLevel(map, texSampler, equirectUV(dir), 0.0);
    textureStore(outTexture, vec2i(global_id.xy), color);
}
