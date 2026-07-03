// Projects the dynamic-IBL source cube onto 9 spherical-harmonic coefficients.
// Single 256-thread workgroup: each thread accumulates a strided subset of all
// 6 × size × size texels, then a shared-memory tree reduction folds the sums
// (one coefficient at a time so workgroup storage stays at 4 KB).
//
// Output layout is the contract with pbr.wgsl `evaluateSH` and the JSON path
// (`loadSphericalHarmonics`): 9 × vec4f (vec4-padded rgb), order
// L00, L1-1, L10, L11, L2-2, L2-1, L20, L21, L22, evaluated with the raw
// polynomials (1, y, z, x, xy, yz, 3z²−1, xz, x²−y²). The (A_l/π)·K_l² band
// scales below bake the Lambertian convolution + basis normalization in, so
// the coefficients are irradiance-over-π — same convention as the JSON sets.

struct Uniforms {
    srcMip : u32,
    srcSize : u32,   // face size at srcMip
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var tEnv : texture_2d_array<f32>;
@group(0) @binding(2) var<storage, read_write> shOut : array<vec4f, 9>;

const WG = 256u;
var<workgroup> partial : array<vec3f, WG>;

fn cubeFaceDir(f : u32, s : f32, t : f32) -> vec3f {
    switch f {
        case 0u: { return vec3f( 1.0, -t, -s); }
        case 1u: { return vec3f(-1.0, -t,  s); }
        case 2u: { return vec3f( s,  1.0,  t); }
        case 3u: { return vec3f( s, -1.0, -t); }
        case 4u: { return vec3f( s, -t,  1.0); }
        default: { return vec3f(-s, -t, -1.0); }
    }
}

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(local_invocation_id) lid : vec3u) {
    let tid = lid.x;
    let size = uniforms.srcSize;
    let fsize = f32(size);
    let total = 6u * size * size;

    // (A_l/π)·K_l² — A = (π, 2π/3, π/4) band factors, K = SH basis constants —
    // times the reference JSON's band window (×0.9606 l=1, ×0.8543 l=2, measured
    // against artistworkshop_sh.json): damps ringing from the bright sun disk
    // and keeps runtime SH on the same scale as the JSON-loaded path.
    var shScale = array<f32, 9>(
        0.07957747, 0.15288423, 0.15288423, 0.15288423,
        0.25493637, 0.25493637, 0.02124580, 0.25493637, 0.06373409
    );

    var acc : array<vec3f, 9>;
    for (var c = 0u; c < 9u; c++) {
        acc[c] = vec3f(0.0);
    }

    for (var i = tid; i < total; i += WG) {
        let f = i / (size * size);
        let rem = i % (size * size);
        let x = rem % size;
        let y = rem / size;
        let s = (f32(x) + 0.5) / fsize * 2.0 - 1.0;
        let t = (f32(y) + 0.5) / fsize * 2.0 - 1.0;
        let dir = normalize(cubeFaceDir(f, s, t));

        // cube texel solid angle
        let dA = 4.0 / (fsize * fsize);
        let dw = dA / pow(1.0 + s * s + t * t, 1.5);
        let radiance = textureLoad(tEnv, vec2u(x, y), f, uniforms.srcMip).rgb * dw;

        acc[0] += radiance;
        acc[1] += radiance * dir.y;
        acc[2] += radiance * dir.z;
        acc[3] += radiance * dir.x;
        acc[4] += radiance * (dir.x * dir.y);
        acc[5] += radiance * (dir.y * dir.z);
        acc[6] += radiance * (3.0 * dir.z * dir.z - 1.0);
        acc[7] += radiance * (dir.x * dir.z);
        acc[8] += radiance * (dir.x * dir.x - dir.y * dir.y);
    }

    for (var c = 0u; c < 9u; c++) {
        partial[tid] = acc[c];
        workgroupBarrier();

        var offset = WG / 2u;
        while (offset > 0u) {
            if (tid < offset) {
                partial[tid] += partial[tid + offset];
            }
            workgroupBarrier();
            offset = offset / 2u;
        }

        if (tid == 0u) {
            shOut[c] = vec4f(partial[0] * shScale[c], 0.0);
        }
        workgroupBarrier();
    }
}
