# src/utils/IBLUtils — IBL cubemap build

`IBLUtils.js` (entry `loadIBLCubeMap(gpu, {url, faceSize, mipLevels?})`) plus the three
compute shaders it owns, co-located because nothing else imports them: `ggx.wgsl` (GGX
specular prefilter), `unpackequirect.wgsl` / `unpackoct.wgsl` (env-map → cube unpack).
Import them relative (`./ggx.wgsl?raw`); the sibling utils are one level up (`../BufferUtils`).
General-purpose pbr shaders (`pbr.wgsl`, `brdflut.wgsl`, `display.wgsl`) stay in
`@modules/pbr/`. Exported through the `ogpu` barrel, not the `@utils` alias.

## Gotchas

- **Two distinct mip chains — don't conflate them.** The build has a _source_ pyramid
  and an _output_ pyramid:
    - **Source env cube mips** (`unpackToCube` → `generateMipmap`): plain box downsample,
      cheap, NOT integrated. These are the _input_ to the convolution.
    - **Output prefiltered cube mips** (`prefilterCube`, written by `ggx.wgsl`): full GGX
      importance-sample integration, one mip per roughness level.

    It is not "each output mip gets a blurrier input." Every output mip/face/sample picks
    its source mip independently from the sample's solid angle vs texel solid angle
    (`0.5*log2(saSample/saTexel)` in `ggx.wgsl`): low-pdf (sparse) samples read a high
    source mip, so a lone hot texel is pre-averaged before entering the 1024-sample sum.
    That box-filtered source pyramid is variance reduction for the Monte Carlo integral
    (Karis/chetanjags trick).

- **Unpacked env cube needs a full mip chain.** The above is inert if the source has only
  mip 0 — `textureSampleLevel` clamps to mip 0 and a single hot texel gets weighted into
  the result → fireflies/bright dots. So `unpackToCube` builds the full chain and calls
  `generateMipmap` after writing mip 0. `createDestinationCube` therefore carries
  `RENDER_ATTACHMENT` usage (generateMipmap renders into the mips). See LearnOpenGL
  "Bright dots in the pre-filter convolution".
- **Source cube is transient.** It exists only as the integration input; `prefilterCube`
  calls `sourceCube.destroy()` right after submitting the GGX pass (commands already
  enqueued, so the device keeps it alive until the GPU finishes). The returned IBL result
  no longer carries `sourceCube` — only the prefiltered `texture`/`view`, `mipLevels`,
  `faceSize`.
- **Mip count is a contract with the shader.** `loadIBLCubeMap` returns `mipLevels`;
  `pbr.wgsl` consumers must feed it back as the `roughnessLevels` override constant or the
  roughness→lod mapping is wrong (see `src/modules/CLAUDE.md` pbr/).
- All IBL textures are `rgba16float`; the storage shaders declare
  `texture_storage_2d<rgba16float, write>`. Change one, change both.
