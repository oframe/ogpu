enable f16;

const PI = 3.14159265358979323846;

@binding(0) @group(0) var brdflutOutput: texture_storage_2d<rgba16float, write>;

fn RadicalInverse_VdC(bits: u32) -> f32 {
    var b = bits;
    b = (b << 16u) | (b >> 16u);
    b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
    b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
    b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
    b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
    return f32(b) * 2.3283064365386963e-10; // / 0x100000000
}

fn Hammersley(i: u32, N: u32) -> vec2f {
    return vec2f(f32(i) / f32(N), RadicalInverse_VdC(i));
}

fn ImportanceSampleGGX(Xi: vec2f, Roughness: f32, N: vec3f) -> vec3f {
    let a = Roughness * Roughness;
    let Phi = 2.0 * PI * Xi.x;
    let CosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
    let SinTheta = sqrt(1.0 - CosTheta * CosTheta);
    var H = vec3f(0.0, 0.0, 0.0);
    H.x = SinTheta * cos(Phi);
    H.y = SinTheta * sin(Phi);
    H.z = CosTheta;
    let UpVector = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(N.z) < 0.999);
    let TangentX = normalize(cross(UpVector, N));
    let TangentY = cross(N, TangentX);

    return TangentX * H.x + TangentY * H.y + N * H.z;
}

fn G_SchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let a = roughness;
    let k = (a * a) / 2.0;
    let nom = NdotV;
    let denom = NdotV * (1.0 - k) + k;
    return nom / denom;
}

fn G_Smith(roughness: f32, NoV: f32, NoL: f32) -> f32 {
    let ggx2 = G_SchlickGGX(NoV, roughness);
    let ggx1 = G_SchlickGGX(NoL, roughness);
    return ggx1 * ggx2;
}

fn IntegrateBRDF(Roughness: f32, NoV: f32) -> vec2f {
    let V = vec3f(sqrt(1.0 - NoV * NoV), 0.0, NoV);
    let N = vec3f(0.0, 0.0, 1.0);

    var A = 0.0;
    var B = 0.0;

    for(var i = 0u; i < 1024u; i++) {
        let Xi = Hammersley(i, 1024u);
        let H = ImportanceSampleGGX(Xi, Roughness, N);
        let L = normalize(2.0 * dot(V, H) * H - V);
        let NoL = saturate(L.z);
        let NoH = saturate(H.z);
        let VoH = saturate(dot(V, H));

        if(NoL > 0.0) {
            let G = G_Smith(Roughness, NoV, NoL);
            let G_Vis = G * VoH / (NoH * NoV);
            let Fc = pow(1.0 - VoH, 5.0);
            A += (1.0 - Fc) * G_Vis;
            B += Fc * G_Vis;
        }
    }
    return vec2f(A, B) / 1024.0;
}

@compute @workgroup_size(1, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3u,
) {
    let roughness = (f32(global_id.y) + 0.5) / 512.0;
    let nDotV = (f32(global_id.x) + 0.5) / 512.0;
    let result = IntegrateBRDF(roughness, nDotV);
    textureStore(brdflutOutput, vec2u(global_id.x, global_id.y), vec4f(result, 0.0, 0.0));
}
