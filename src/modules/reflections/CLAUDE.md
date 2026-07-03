# src/modules/reflections — planar mirrors + local reflection probes

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

## PlanarReflector

- **One submit per pass — never chain into a shared encoder.** `Mesh.draw`
  writes each mesh's single uniform buffer via `queue.writeBuffer` at encode
  time. All writeBuffer ops execute before a submitted command buffer runs, so
  two passes drawing the same meshes inside one submit both execute with the
  LAST pass's camera uniforms (this shipped as "mirrors render the main view
  into the reflection target" before the fix). `render()` therefore always
  creates and submits its own encoder; `ReflectionProbe.update` submits per
  face for the same reason. Call reflectors before building the frame's main
  encoder.
- **Format trap.** Scene pipelines are compiled against one target layout; a
  differently formatted reflection target draws nothing (pass/pipeline
  validation). Plain-swapchain apps get the default single
  `presentationFormat` attachment + depth24plus, which matches their content
  pipelines. Apps using the post composer must pass `matchPost: true` — the
  target then mirrors the composer's MRT (rgba16float ×2 + depth32float; the
  normal attachment is wasted, accepted for v1). `planar.wgsl` has a single
  color output — for post-composer use, copy it and add the `@location(1)`
  world-normal output per `src/modules/post/CLAUDE.md`.
- **Winding flips in mirrors.** The reflection matrix has det −1, so
  front faces arrive back-facing. Any content pipeline that must appear in a
  mirror needs `cullMode: 'none'` (or `'front'`). There is no per-pipeline
  cull override in v1.
- **Screen-projected uv is only valid ON the plane.** The mirrored camera's
  clip coords equal the main camera's for plane points only — `planar.wgsl`
  belongs on flat mirror geometry lying in the reflector's plane, nothing
  else.
- **Oblique clip convention.** `reflectCamera` internals: the world plane is
  flipped so the main camera sits on the positive side, moved to mirror-view
  space via `transformPlane(plane, mirrorCam.worldMatrix)`, then folded into
  the projection with `obliqueProjection` (both in `@utils/Mat4Utils`,
  [0, 1]-clip-z variant of Lengyel). Toggle `reflector.obliqueClip = false`
  to see why it exists: geometry below the mirror leaks into the reflection.
  `clipBias` (default 0.003) keeps a little slack under the plane to avoid
  seams where geometry touches the mirror.
- **Mirrored camera is matrices-only.** A reflection isn't a TRS, so the
  internal camera's matrices are written directly and rendered with
  `updateMatrices: false`; its quaternion stays identity — shaders reading
  `cameraQuaternion` (billboards) are approximate inside reflections.
- **Resize.** The reflector resizes itself off the renderer's resize handler
  (when auto-sized), destroys the old depth texture, and rebuilds the mip
  chain. All old views die — rebuild the mirror mesh's bind group in
  `addRebuildHandler` (use `reflector.bindGroup(pipeline, mesh.uniformBuffer)`).
- **Glossy chain.** `mipLevels > 1` allocates a separate mip-chain texture:
  Renderer.render attaches full-mip views, so the scene renders into the
  single-mip target, is copied into mip 0, then Kawase-downsampled per mip.
  `blur = false` skips the chain — clamp the surface's `uMaxLod` to 0 too or
  it reads stale mips.
- **No mirror-in-mirror.** Pass other mirror surfaces in `hide: [...]`; their
  screen-projected uvs are wrong in another mirror's pass.

## ReflectionProbe

- **Cube-face handedness.** Cube faces are left-handed seen from inside, so
  the probe camera negates the projection's x column and uses per-face up
  vectors matching the WebGPU layer order (+x −x +y −y +z −z). Consequence:
  winding flips here too — probe-visible content wants `cullMode: 'none'`,
  same guidance as mirrors.
- **Own submit.** `update()` submits its face renders itself before calling
  webgpu-utils `generateMipmap` (which creates and submits its own encoder) —
  chaining it into an external encoder would generate mips from stale faces.
  Call `tick`/`update` before building the frame's main encoder.
- **Renderer face adapter.** `Renderer.render` attaches
  `target.textures[i].texture.createView()` — a full view, invalid for one
  cube face — so the probe hands it minimal RenderTarget-shaped adapters
  serving prebuilt single-layer views. If Renderer's target contract changes,
  update the adapters.
- **Mip ≈ roughness (v1).** Mips are plain box downsamples via
  `generateMipmap`; `lod = roughness * (mipLevelCount - 1)` is an
  approximation. TODO hook: swap in GGX prefiltering from IBLUtils'
  `createDynamicIBL` when it lands (same cube view contract).
- The cube texture is never recreated, so consumer bind groups stay valid
  across probe updates.

## Box-projection consumer snippet (parallax-corrected cubemap, Lagarde 2012)

Paste into any material sampling a probe (`tEnv: texture_cube<f32>`):

```wgsl
// worldPos: fragment world position; dir: reflect(-viewDir, n);
// boxMin/boxMax: probe box bounds; probePos: probe capture position.
fn boxProject(dir: vec3f, worldPos: vec3f, boxMin: vec3f, boxMax: vec3f, probePos: vec3f) -> vec3f {
  let firstPlane = (boxMax - worldPos) / dir;
  let secondPlane = (boxMin - worldPos) / dir;
  let furthest = max(firstPlane, secondPlane);
  let dist = min(min(furthest.x, furthest.y), furthest.z);
  let hit = worldPos + dir * dist;
  return hit - probePos;
}

// let lod = roughness * uMaxLod; // uMaxLod = probe.mipLevelCount - 1
// let env = textureSampleLevel(tEnv, probeSampler, boxProject(...), lod).rgb;
```

Division by a zero direction component yields ±inf, which the max/min chain
resolves correctly — no epsilon needed. See `examples/mirrors/probelit.wgsl`
for a full material.
