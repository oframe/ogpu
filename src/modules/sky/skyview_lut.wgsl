// Sky-view LUT (Hillaire 2020 subset) + cube-face writer.
//
// `main` (192×108): u = sun-relative azimuth |φ| ∈ [0, π] (the sky is mirror-
// symmetric about the sun azimuth), v = non-linear elevation (sqrt mapping,
// resolution concentrated at the horizon). Physical mode: single-scattering
// march against the transmittance LUT + a cheap uniform multiple-scattering
// term. Artistic mode: pure gradient stops, no atmosphere math. The grading
// layer (palette tints / saturation / contrast) is baked into the LUT so both
// consumers (sky.wgsl background + cubeFaces) read finished radiance.
//
// `cubeFaces`: samples the LUT + adds the sun disk, writes one face (mip 0) of
// the dynamic-IBL source cube per dispatch. km units throughout.

const PI = 3.14159265358979323846;
const GROUND_R = 6360.0;
const TOP_R = 6460.0;
const STEPS = 32;

struct Uniforms {
    rayleighScatter : vec3f,
    mieScatter : f32,
    ozoneAbsorb : vec3f,
    mieAbsorb : f32,
    msFactor : vec3f,        // uniform multiple-scattering ambient, pre-scaled CPU-side
    sunIntensity : f32,
    groundAlbedo : vec3f,
    mieG : f32,
    sunElevation : f32,      // rad
    sunAzimuth : f32,        // rad, world azimuth (cubeFaces only)
    viewHeight : f32,        // km above ground
    mode : f32,              // 0 = physical, 1 = artistic
    zenithColor : vec4f,     // artistic stops, rgb pre-scaled by intensity
    horizonColor : vec4f,
    groundColor : vec4f,
    haloColor : vec4f,       // .a = halo exponent
    tintZenith : vec4f,      // grading tints
    tintHorizon : vec4f,
    tintSunHalo : vec4f,
    tintShadow : vec4f,      // .a = shadow-tint amount
    gradeAmount : f32,
    saturation : f32,
    contrast : f32,
    sunDiskCos : f32,        // cos(disk angular radius)
    sunColor : vec4f,        // rgb = disk radiance (cubeFaces only)
    sunDiskSoftness : f32,
}

struct FaceUniforms {
    index : u32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var tTransmittance : texture_2d<f32>;
@group(0) @binding(2) var skyviewOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var lutSampler : sampler;
@group(0) @binding(4) var tSkyview : texture_2d<f32>;
@group(0) @binding(5) var faceOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> face : FaceUniforms;

fn densities(h : f32) -> vec3f {
    return vec3f(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}

// Bruneton (r, mu) -> transmittance LUT uv (matches transmittance_lut.wgsl).
fn transmittanceUv(r : f32, mu : f32) -> vec2f {
    let bigH = sqrt(TOP_R * TOP_R - GROUND_R * GROUND_R);
    let rho = sqrt(max(r * r - GROUND_R * GROUND_R, 0.0));
    let disc = r * r * (mu * mu - 1.0) + TOP_R * TOP_R;
    let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
    let dMin = TOP_R - r;
    let dMax = rho + bigH;
    return vec2f((d - dMin) / (dMax - dMin), rho / bigH);
}

fn sampleTransmittance(r : f32, mu : f32) -> vec3f {
    return textureSampleLevel(tTransmittance, lutSampler, transmittanceUv(r, mu), 0.0).rgb;
}

// Single scattering + uniform multiple-scattering ambient. Local frame: y up,
// sun in the y/z plane at uniforms.sunElevation.
fn scatter(dir : vec3f, sunDir : vec3f) -> vec3f {
    let r0 = GROUND_R + max(uniforms.viewHeight, 0.01);

    // intersection with atmosphere top / ground (origin (0, r0, 0))
    let b = r0 * dir.y;
    var tMax = -b + sqrt(max(b * b - (r0 * r0 - TOP_R * TOP_R), 0.0));
    var hitGround = false;
    let discG = b * b - (r0 * r0 - GROUND_R * GROUND_R);
    if (dir.y < 0.0 && discG > 0.0) {
        let tG = -b - sqrt(discG);
        if (tG > 0.0) {
            tMax = tG;
            hitGround = true;
        }
    }

    let nu = dot(dir, sunDir);
    let phaseR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
    let g = uniforms.mieG;
    let phaseM = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * nu, 1e-4), 1.5));

    let dt = tMax / f32(STEPS);
    var throughput = vec3f(1.0);
    var inscatter = vec3f(0.0);

    for (var i = 0; i < STEPS; i++) {
        let t = (f32(i) + 0.5) * dt;
        let p = vec3f(0.0, r0, 0.0) + dir * t;
        let rP = length(p);
        let h = max(rP - GROUND_R, 0.0);
        let d = densities(h);

        let scatterR = uniforms.rayleighScatter * d.x;
        let scatterM = vec3f(uniforms.mieScatter * d.y);
        let ext = max(scatterR + vec3f((uniforms.mieScatter + uniforms.mieAbsorb) * d.y) + uniforms.ozoneAbsorb * d.z, vec3f(1e-6));
        let stepTrans = exp(-ext * dt);

        let up = p / rP;
        let muS = dot(up, sunDir);
        // earth shadow: sun below the local horizon gets no direct light
        let horizonMu = -sqrt(max(1.0 - (GROUND_R * GROUND_R) / (rP * rP), 0.0));
        var sunTrans = vec3f(0.0);
        if (muS > horizonMu) {
            sunTrans = sampleTransmittance(rP, muS);
        }

        let s = (scatterR * phaseR + scatterM * phaseM) * sunTrans * uniforms.sunIntensity + (scatterR + scatterM) * uniforms.msFactor;

        // analytic per-step integration (Hillaire): ∫ s·e^(-ext·x) dx over the step
        inscatter += throughput * (s - s * stepTrans) / ext;
        throughput *= stepTrans;
    }

    if (hitGround) {
        let p = vec3f(0.0, r0, 0.0) + dir * tMax;
        let up = p / length(p);
        let muS = dot(up, sunDir);
        let sunTrans = sampleTransmittance(length(p), max(muS, 0.0));
        let ground = uniforms.groundAlbedo / PI * (sunTrans * uniforms.sunIntensity * max(muS, 0.0) + uniforms.msFactor);
        inscatter += throughput * ground;
    }

    return inscatter;
}

// Artistic mode: gradient stops keyed by elevation + sun halo. Stops arrive
// already blended by time-of-day curves (Sky.js) and pre-scaled to radiance.
fn gradient(dir : vec3f, sunDir : vec3f) -> vec3f {
    let up = dir.y;
    var col = mix(uniforms.horizonColor.rgb, uniforms.zenithColor.rgb, pow(clamp(up, 0.0, 1.0), 0.6));
    col = mix(col, uniforms.groundColor.rgb, smoothstep(0.0, -0.12, up));
    let halo = pow(max(dot(dir, sunDir), 0.0), max(uniforms.haloColor.a, 1.0));
    col += uniforms.haloColor.rgb * halo * step(0.0, up + 0.05);
    return col;
}

// Grading layer, both modes: palette tint remap + saturation + HDR-safe contrast.
fn grade(colIn : vec3f, dir : vec3f, sunDir : vec3f) -> vec3f {
    var col = colIn;
    let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
    let up = clamp(dir.y, 0.0, 1.0);
    let sunAmount = pow(max(dot(dir, sunDir), 0.0), 4.0);

    var tint = mix(uniforms.tintHorizon.rgb, uniforms.tintZenith.rgb, smoothstep(0.05, 0.6, up));
    tint = mix(tint, uniforms.tintSunHalo.rgb, sunAmount);
    let shadowMask = (1.0 - smoothstep(0.0, 0.5, lum)) * uniforms.tintShadow.a;
    tint = mix(tint, uniforms.tintShadow.rgb, shadowMask);

    col *= mix(vec3f(1.0), tint, uniforms.gradeAmount);

    let lumG = dot(col, vec3f(0.2126, 0.7152, 0.0722));
    col = mix(vec3f(lumG), col, uniforms.saturation);

    // contrast pivots on mid-grey so HDR values don't blow out
    col = 0.18 * pow(max(col, vec3f(0.0)) / 0.18, vec3f(uniforms.contrast));
    return col;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let dims = textureDimensions(skyviewOut);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(dims);

    // decode: u -> relative azimuth, v -> sqrt-mapped elevation
    let phi = uv.x * PI;
    let c = 2.0 * uv.y - 1.0;
    let elev = sign(c) * c * c * (PI * 0.5);

    let cosE = cos(elev);
    let dir = vec3f(cosE * sin(phi), sin(elev), cosE * cos(phi));
    let sunDir = vec3f(0.0, sin(uniforms.sunElevation), cos(uniforms.sunElevation));

    var radiance : vec3f;
    if (uniforms.mode < 0.5) {
        radiance = scatter(dir, sunDir);
    } else {
        radiance = gradient(dir, sunDir);
    }
    radiance = grade(radiance, dir, sunDir);

    textureStore(skyviewOut, vec2i(id.xy), vec4f(radiance, 1.0));
}

// ---- cube-face writer (dynamic IBL source) ----

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

// world direction -> sky-view LUT uv (must mirror the encode in `main`)
fn skyviewUv(dir : vec3f, sunAzimuth : f32) -> vec2f {
    let elev = asin(clamp(dir.y, -1.0, 1.0));
    let az = atan2(dir.x, dir.z);
    var dPhi = abs(az - sunAzimuth);
    dPhi = min(dPhi, 2.0 * PI - dPhi);
    return vec2f(dPhi / PI, 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5)));
}

@compute @workgroup_size(8, 8, 1)
fn cubeFaces(@builtin(global_invocation_id) id : vec3u) {
    let dims = textureDimensions(faceOut);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(dims);
    let s = 2.0 * uv.x - 1.0;
    let t = 2.0 * uv.y - 1.0;
    let dir = normalize(cubeFaceDir(face.index, s, t));

    var col = textureSampleLevel(tSkyview, lutSampler, skyviewUv(dir, uniforms.sunAzimuth), 0.0).rgb;

    // sun disk baked into the env map so the specular prefilter picks it up
    let cosE = cos(uniforms.sunElevation);
    let sunDir = vec3f(cosE * sin(uniforms.sunAzimuth), sin(uniforms.sunElevation), cosE * cos(uniforms.sunAzimuth));
    let inner = mix(uniforms.sunDiskCos, 1.0, clamp(uniforms.sunDiskSoftness, 0.05, 1.0));
    col += uniforms.sunColor.rgb * smoothstep(uniforms.sunDiskCos, inner, dot(dir, sunDir));

    textureStore(faceOut, vec2i(id.xy), vec4f(col, 1.0));
}
