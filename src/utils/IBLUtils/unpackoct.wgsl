enable f16;

struct Uniforms {
    resolution: f32,
    faceIndex: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var map: texture_2d<f32>;
@group(0) @binding(2) var outTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var texSampler: sampler;

fn octahedralProjection(dir: vec3f) -> vec2f {
    let _dir = dir / dot(vec3f(1.0, 1.0, 1.0), abs(dir));
    let rev = abs(_dir.zx) - vec2f(1.0, 1.0);
    let neg = vec2f(
        select(-rev.x, rev.x, _dir.x < 0.0),
        select(-rev.y, rev.y, _dir.z < 0.0)
    );
    let uv = select(_dir.xz, neg, _dir.y < 0.0);
    return uv * 0.5 + 0.5;
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

    let color = textureSampleLevel(map, texSampler, octahedralProjection(dir), 0.0);
    textureStore(outTexture, vec2i(global_id.xy), color);
}
