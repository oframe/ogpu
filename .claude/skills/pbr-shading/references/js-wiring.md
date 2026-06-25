# PBR JS wiring — copy-paste blocks

All blocks assume `this.gpu = renderer.gpu` after `await renderer.ready`.
Canonical working sources: `examples/gltf/GLTF.js` (stock `pbr.wgsl` via
`GLTFLoader`) and `examples/pbrshader/PBRShader.js` (hand-wired bind group,
fallback textures, per-part material buffers). Copy from those files, not from
memory — they are the ground truth for the binding layout and resource shapes.

## IBL resources (specular cube + SH + BRDF LUT)

`initIBL()` builds the three lighting inputs once. Imports (they come through the
`ogpu` barrel; `@utils`/`@core`/`@modules` aliases also work):

```js
import { ComputeShader, createUniformBuffer, loadIBLCubeMap, loadSphericalHarmonics } from 'ogpu';
import brdflut from '@modules/pbr/brdflut.wgsl?raw';
```

```js
async initIBL({
    url = './assets/pbr/artistworkshop_oct.exr',
    shUrl = './assets/pbr/artistworkshop_sh.json',
} = {}) {
    // Specular: decode env map -> cube -> GGX-prefilter one roughness level per
    // mip. Returns { view, mipLevels, faceSize }. mipLevels is a contract with
    // the shader (see roughnessLevels below) — keep it.
    const ibl = await loadIBLCubeMap(this.gpu, {
        url,
        faceSize: 256,
        mipLevels: 6,
        label: 'specular-ibl',
    });

    // Diffuse irradiance: 9 SH coefficients from a precomputed JSON, returned as
    // a vec4-padded Float32Array, uploaded to a uniform buffer.
    const shArray = await loadSphericalHarmonics(shUrl);
    const shBuffer = createUniformBuffer(this.gpu, {
        label: 'sh-constants-buffer',
        size: shArray.byteLength,
    });
    this.gpu.device.queue.writeBuffer(shBuffer, 0, shArray);

    // BRDF LUT: split-sum integration into a 512x512 storage texture at runtime.
    const lutTexture = this.gpu.device.createTexture({
        size: [512, 512],
        format: 'rgba16float',
        usage:
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        label: 'brdflut-texture',
    });

    const brdflutCompute = new ComputeShader(this.gpu, {
        label: 'brdflut-compute',
        code: brdflut,
    });
    const kernel = brdflutCompute.findKernel('main');
    const bindGroup = this.gpu.device.createBindGroup({
        label: 'brdflut-bind-group',
        layout: brdflutCompute.bindGroupLayout(kernel),
        entries: [{ binding: 0, resource: lutTexture.createView() }],
    });

    const encoder = this.gpu.device.createCommandEncoder({ label: 'brdflut-encoder' });
    const pass = encoder.beginComputePass({ label: 'brdflut-pass' });
    brdflutCompute.dispatch(encoder, {
        pass,
        kernel,
        bindGroup,
        dispatchCount: [512, 512, 1],
    });
    pass.end();
    this.gpu.device.queue.submit([encoder.finish()]);

    // mipLevels flows on to the pipeline's roughnessLevels override constant.
    return { specView: ibl.view, mipLevels: ibl.mipLevels, shBuffer, lutTexture };
}
```

Call as `const ibl = await this.initIBL();`. `loadIBLCubeMap` is EXR-decode +
GGX-prefilter heavy; if the boot overlay should hold until it settles, wrap the
promise with `renderer.trackCompile(promise)`.

### Spherical harmonics — what loadSphericalHarmonics consumes/produces

`loadSphericalHarmonics(url)` reads a JSON like `assets/pbr/artistworkshop_sh.json`
(`{ bands, irradiance, coefficients: [{ name, rgb: [r,g,b] }, … ×9] }`) — nine
precomputed, irradiance-convolved RGB coefficients. It returns a `Float32Array`
laid out as nine `vec4`s (`[r,g,b,0]` each), padded so it uploads straight into a
`std140`-ish uniform buffer. In `pbr.wgsl` that buffer is the `SHConstants` block
(`coefficients: array<vec4f, 9>`); `evaluateSH(normal, …)` reconstructs diffuse
irradiance per pixel from the surface normal — a few constants standing in for a
diffuse-convolved cubemap. There is no runtime SH baking here; the JSON is the
precomputed input.

## roughnessLevels override constant

`loadIBLCubeMap` returns `mipLevels`; the prefiltered cube has one GGX-integrated
roughness level per mip. Pass it to the pipeline so the shader's roughness→lod
mapping matches the cube it samples:

```js
const pipeline = new RenderPipeline(this.gpu, {
    label: 'pbr-pipeline',
    vertexBuffers: geometry.bufferLayouts,
    code: pbr,
    constants: { roughnessLevels: ibl.mipLevels },
    transparent, // when the material has an opacity/alpha-blend path
});
```

`pbr.wgsl` declares `override roughnessLevels : f32 = 6.0` and maps roughness
`[0,1]` → lod `[0, roughnessLevels - 1]`. Omit the constant only if you still
build the legacy 6-level cube; otherwise a mismatch skews every reflection.

## Samplers

```js
const iblSampler = this.gpu.device.createSampler({
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
});

const materialSampler = this.gpu.device.createSampler({
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
});
```

## Fallback textures (when the user provides no maps)

```js
solidTexture(rgba, label) {
    const texture = this.gpu.device.createTexture({
        size: [2, 2],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        label,
    });
    const data = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) data.set(rgba, i * 4);
    this.gpu.device.queue.writeTexture(
        { texture },
        data,
        { bytesPerRow: 8, rowsPerImage: 2 },
        { width: 2, height: 2 }
    );
    return texture;
}
```

```js
const whiteTex = this.solidTexture([255, 255, 255, 255], 'white-placeholder');
const blackTex = this.solidTexture([0, 0, 0, 255], 'black-placeholder');
```

Slot assignment — substitute any map the user actually has. Note `pbr.wgsl`
reads roughness from `.g`, metalness from `.b`, occlusion from `.r`; the example
binds one swizzled RMO map to both the metallic-roughness and occlusion slots.

| binding | uniform              | fallback | why                                              |
| ------- | -------------------- | -------- | ------------------------------------------------ |
| 5       | `tMap`               | white    | sample = 1 → `baseColorFactor` drives albedo     |
| 6       | `tMetallicRoughness` | white    | g/b = 1 → roughness/metallic factors drive it    |
| 7       | `tNormal`            | black    | unused; pair with `hasNormalMap: 0`              |
| 8       | `tOcclusion`         | white    | ao = 1 → no darkening                            |
| 9       | `tEmissive`          | black    | no emission (or `emissiveFactor: [0,0,0]`)       |
| 11      | `tOpacity`           | white    | `.g` = 1 → fully opaque (bind white when opaque) |

## Material uniforms (separate uniform block, binding 12)

Material factors are NOT in the per-frame `Uniforms` block — they live in their
own `Material` struct at binding 12, so they're set once at init (or on a GUI
change) into their own buffer, independent of the per-draw uniforms `Mesh.draw`
writes. Build a structured view from reflection, set every field (webgpu-utils
zero-initializes, and a zeroed `baseColorFactor` renders black), then upload:

```js
const materialView = makeStructuredView(pipeline.defs.uniforms.material);
materialView.set({
    baseColorFactor: [1, 1, 1, 1],
    emissiveFactor: [0, 0, 0],
    metallicFactor: 0.0,
    roughnessFactor: 0.5,
    normalScale: 1.0,
    occlusionStrength: 1.0,
    alphaCutoff: 0.5,
    alphaMode: 0, // 0 OPAQUE, 1 MASK, 2 BLEND
    hasNormalMap: 0, // 1 only when a real tNormal is bound
    hasTangents: geometry.hasTangents ? 1 : 0, // 1 = TBN from vertex tangent
    useGeometricNormal: 0, // 1 = ignore the normal map entirely
});

const materialBuffer = createUniformBuffer(this.gpu, {
    label: 'pbr-material',
    size: materialView.arrayBuffer.byteLength,
});
this.gpu.device.queue.writeBuffer(materialBuffer, 0, materialView.arrayBuffer);
```

(`makeStructuredView` and `createUniformBuffer` are imported from `webgpu-utils`
and the `ogpu` barrel respectively.)

## Bind group (stock pbr.wgsl layout)

`RenderPipeline` exposes the layout via `pipeline.bindGroupLayout(group)` and the
reflected defs via `pipeline.defs` — it does NOT own a uniform buffer or a
`createBindGroup` helper, so build the bind group with the device. The per-draw
uniform buffer is owned by the `Mesh` and handed to the `bindGroups` callback:

```js
const mesh = new Mesh(this.gpu, {
    label: 'pbr-mesh',
    pipeline,
    geometry,
    bindGroups: (uniformBuffer) => [
        this.gpu.device.createBindGroup({
            layout: pipeline.bindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } }, // per-frame Uniforms (Mesh.draw)
                { binding: 1, resource: ibl.specView }, // tSpecular (cube)
                { binding: 2, resource: { buffer: ibl.shBuffer } }, // SHConstants
                { binding: 3, resource: ibl.lutTexture.createView() }, // tBrdf
                { binding: 4, resource: iblSampler },
                { binding: 5, resource: whiteTex.createView() }, // tMap
                { binding: 6, resource: whiteTex.createView() }, // tMetallicRoughness
                { binding: 7, resource: blackTex.createView() }, // tNormal
                { binding: 8, resource: whiteTex.createView() }, // tOcclusion
                { binding: 9, resource: blackTex.createView() }, // tEmissive
                { binding: 10, resource: materialSampler },
                { binding: 11, resource: whiteTex.createView() }, // tOpacity (white = opaque)
                { binding: 12, resource: { buffer: materialBuffer } }, // Material
            ],
        }),
    ],
});
```

`Mesh.draw` uploads the per-frame `Uniforms` each frame; the `Material` buffer is
yours to update (e.g. on a GUI change, re-`set` the view and re-`writeBuffer`).

If the shader was folded into a custom layout (different binding numbers), derive
entries from reflection instead of hardcoding:
`pipeline.defs.textures.<name>.binding` / `pipeline.defs.samplers.<name>.binding`
/ `pipeline.defs.uniforms.<name>.binding`.

## GLTFLoader path

When the target is a glTF asset, skip all per-material wiring — construct
`new GLTFLoader(gpu, { code: pbr, iblEntries, constants: { roughnessLevels: ibl.mipLevels } })`
where `iblEntries` is just bindings 1–4 above:

```js
const iblEntries = [
    { binding: 1, resource: ibl.specView },
    { binding: 2, resource: { buffer: ibl.shBuffer } },
    { binding: 3, resource: ibl.lutTexture.createView() },
    { binding: 4, resource: iblSampler },
];
```

The loader binds material maps + factors itself (and creates its own placeholder
textures for missing maps), and reads vertex tangents from the asset when present.
