enable f16;

const PI = 3.14159265358979323846;

struct Uniforms {
    resolution: f32,
    sourceResolution: f32,
    roughness: f32,
    mipLevel: f32,
    faceIndex: u32,
}

@binding(0) @group(0) var<uniform> uniforms: Uniforms;
@binding(1) @group(0) var map: texture_cube<f32>;
@binding(2) @group(0) var level: texture_storage_2d<rgba16float, write>;
@binding(3) @group(0) var texSampler: sampler;

fn RadicalInverse_VdK(inBits: u32) -> f32 {
    var bits = inBits;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

fn Hammersley(i: u32, N: u32) -> vec2f {
    return vec2f(f32(i) / f32(N), RadicalInverse_VdK(i));
}

fn DistributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH2 = NdotH * NdotH;
    let num = a2;
    var denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    return num / denom;
}

fn ImportanceSampleGGX(Xi: vec2f, roughness: f32, N: vec3f) -> vec3f {
    let a = roughness * roughness;

    let phi = 2.0 * PI * Xi.x;
    let cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

    let H = vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

    let up    = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(N.z) < 0.999);
    let tan   = normalize(cross(up, N));
    let bitan = cross(N, tan);

    return normalize(tan * H.x + bitan * H.y + N * H.z);
}

fn PrefilterEnvMap(Roughness: f32, R: vec3f) -> vec3f {
    let N = R;
    let V = R;
    var PrefilteredColor = vec3f(0.0);
    var totalWeight = 0.0;

    const NumSamples = 1024u;

    for (var i = 0u; i < NumSamples; i++) {
        let Xi = Hammersley(i, NumSamples);
        let H = ImportanceSampleGGX(Xi, Roughness, N);
        let L = 2.0 * dot(V, H) * H - V;
        let NoL = max(0.0, dot(N, L));
        if (NoL > 0.0) {
            let NdotH = max(dot(N, H), 0.0);
            let HdotV = max(dot(H, V), 0.0);
            let D = DistributionGGX(NdotH, Roughness);
            let pdf = (D * NdotH / (4.0 * HdotV)) + 0.0001;

            let saTexel = 4.0 * PI / (6.0 * uniforms.sourceResolution * uniforms.sourceResolution);
            let saSample = 1.0 / (f32(NumSamples) * pdf + 0.0001);

            let mipLevel = select(0.5 * log2(saSample / saTexel), 0.0, Roughness == 0.0);

            PrefilteredColor += textureSampleLevel(map, texSampler, L, mipLevel).xyz * NoL;
            totalWeight += NoL;
        }
    }
    return PrefilteredColor / totalWeight;
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

    let color = select(
        textureSampleLevel(map, texSampler, dir, 0.0).xyz,
        PrefilterEnvMap(uniforms.roughness, dir),
        uniforms.mipLevel > 0.0
    );
    textureStore(level, vec2i(global_id.xy), vec4f(color, 1.0));
}
