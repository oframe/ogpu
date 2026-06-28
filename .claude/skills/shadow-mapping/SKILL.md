---
name: shadow-mapping
description: Fold real-time shadow mapping into an existing RenderPipeline/shader in the OGPU engine. Use whenever the user wants cast shadows, a depth-pass / shadow-map shadow, a character or mesh to drop a shadow on a floor, self-shadowing, PCF soft shadows, "make it cast a shadow", "add shadows", or real-time shadows on a custom (skinned, displaced, instanced, IBL-lit) shader. Covers the depth-only caster pass + the receiver sampling fold.
---

# Fold shadow mapping into a RenderPipeline

The engine has no shadow primitive. Shadow mapping is two passes you wire by
hand: (1) a **depth-only caster pass** that renders the occluders from the
light's POV into a depth `RenderTarget`, and (2) **receivers** that sample that
depth map with a comparison sampler + PCF and darken their lighting. There is no
shader-chunk system — integration means copying the WGSL pieces into the target
shader and wiring the JS. This skill says which pieces and what breaks silently.

Two canonical, working implementations already in the repo — read the one that
matches the geometry:

- `examples/shadowmapping/` — **static** geometry (plain vertex attributes).
  `shadow.wgsl` caster, `mesh.wgsl` receiver. The minimal reference.
- `examples/skinninggltf/` — **skinned + IBL** character. `shadowcaster.wgsl`
  pulls skinned positions from the Skin compute buffer so the cast shadow tracks
  the animation; `skinnedmesh.wgsl` receives (self-shadow), `floor.wgsl` receives
  (contact shadow). The reference for any compute/skinned/IBL case.

## Decide the integration shape

1. **Static geometry (vertex attributes)** → caster shader is a vertex-only
   `MVP * position` from the light camera. Copy `examples/shadowmapping/shadow.wgsl`.
2. **Skinned / compute-positioned / displaced geometry** → the caster MUST pull
   position the same way the main vertex stage does (same storage buffer, same
   `@builtin(vertex_index)` indexing) or the shadow detaches from the animated
   mesh. Copy `examples/skinninggltf/shadowcaster.wgsl`.
3. **IBL-only / ambient-only shader (no punctual light)** → there is nothing for
   a shadow to occlude. Add a directional light gated by the shadow factor, or
   the "shadow" does nothing visible. See `references/folding.md`.

The JS wiring (depth target, light camera, caster mesh, shadow uniform,
comparison sampler, receiver bindings, two-pass render loop) is the same shape
in every case — `references/folding.md` has the copy-paste blocks.

## Workflow

1. **Read the target shader + its geometry and render loop.** Note how the main
   vertex stage gets its position (attribute vs storage buffer) — the caster must
   match it. Confirm the receiver's `Uniforms` already carries `modelMatrix` and
   `viewMatrix` (needed for world pos + the lit term).
2. **Depth `RenderTarget`:** `color: false`, `depthTexture: true`,
   `depthFormat: 'depth32float'`, square (`SHADOW_SIZE = 2048`).
3. **Light camera:** orthographic (`{ left, right, top, bottom, near, far }`)
   placed at the light, `lookAt(target)`, then `updateMatrixWorld()`. Ortho
   extents must bound the occluders — too large wastes resolution and causes
   acne; geometry outside the frustum is silently unshadowed. Build
   `shadowVP = new Mat4().copy(cam.projectionMatrix).multiply(cam.viewMatrix)`.
4. **Caster pipeline:** vertex-only WGSL — declare NO `fs` entry point so
   `RenderPipeline` emits no fragment stage and no color target (it auto-detects
   `defs.entryPoints.fs`). Pass `depthStencil` verbatim with `format:
   'depth32float'`, `depthWriteEnabled: true`, `depthCompare: 'less'`, and slope
   bias (`depthBias: 1`, `depthBiasSlopeScale: 1.75`). Make a separate `Mesh`
   sharing the geometry (and the skin storage buffer for skinned). Set
   `frustumCulled = false` on skinned casters.
5. **Shadow uniform buffer:** a `Shadow { projectionViewMatrix : mat4x4f,
   lightDirection : vec3f }` block. `makeStructuredView` it off any receiver
   pipeline's `defs.uniforms.shadowUniforms`, `set` both fields, write once.
   Keep the struct identical across every receiver that shares this buffer.
6. **Comparison sampler:** `compare: 'less'`, `min/magFilter: 'linear'`,
   `addressMode*: 'clamp-to-edge'`. Bind it as `sampler_comparison` against a
   `texture_depth_2d` view of the target's `depthTexture`.
7. **Fold receiving into each receiver shader:** add the `Shadow` uniform +
   `sampler_comparison` + `texture_depth_2d` bindings and an `override
   shadowDepthTextureSize`. Vertex computes `vShadowCoord` (NDC→UV, **flip y**).
   Fragment runs PCF (`shadowVisibility`) and gates the light term. Full blocks
   in `references/folding.md`.
8. **Render loop:** render the caster scene to the depth target with the light
   camera FIRST, then the lit scene with the real camera:
   `renderer.render({ scene: casterMesh, camera: lightCamera, target: shadowBuffer })`
   then `renderer.render({ scene, camera })`.
9. **Verify:** `npm run validate:shaders` (folded WGSL) and `npm run build`.
   Examples live outside `src/`, so if you add files the repomap drift gate
   (`npm run repomap`) needs regenerating before commit.

## Things that break silently

- **Caster must have no `fs`.** A vertex-only module gives a color-target-free
  pipeline that matches the depth-only target. Adding an empty `fs` "to satisfy
  the builder" forces a color target the depth-only render pass can't supply.
- **Shadow-coord y flip.** WebGPU clip-space y is opposite texture v:
  `vShadowCoord = vec4f(ndc.xy * vec2f(0.5, -0.5) + 0.5, ndc.z, 1.0)`. Wrong
  sign mirrors the shadow off the caster.
- **Two-tier depth bias.** `depthBias`/`depthBiasSlopeScale` live on the caster
  pipeline; the receiver subtracts a small constant from `shadowCoord.z` (~0.002)
  in the compare. Too little → shadow acne (self-stripes); too much →
  peter-panning (shadow detaches from contact point). Tune both.
- **Comparison binding types are not the color ones.** A `compare` sampler must
  be `sampler_comparison` + `texture_depth_2d` and sampled with
  `textureSampleCompare`. A normal `sampler`/`texture_2d<f32>` won't compile
  against it (and vice-versa).
- **Skinned caster index must match the main stage.** Same storage buffer, same
  `vertexIndex * 3` stride. A mismatch makes the shadow drift off the mesh while
  the visible mesh looks fine.
- **Shared shadow uniform layout.** Every receiver sampling the same
  `shadowUniformBuffer` must declare an identical `Shadow` struct (keep
  `lightDirection` even if a receiver ignores it) or std140 offsets diverge.
- **IBL-only shaders need an added light.** Multiplying IBL ambient by the shadow
  factor wrongly darkens the whole object. Gate an *added directional* term
  instead; leave the ambient/IBL untouched.
- **`depth32float` is fine for comparison sampling** but can't be linearly
  filtered as a color texture — don't bind it for display/debug without a copy.

## References

- `references/folding.md` — full copy-paste blocks: the caster WGSL (static +
  skinned), the receiver fold (bindings, `Shadow` struct, `vShadowCoord`,
  `hash22`+`shadowVisibility` PCF, light gating incl. the IBL+directional case),
  and the JS (depth target, light camera, caster pipeline+mesh, shadow uniform,
  comparison sampler, receiver bind-group entries, two-pass render loop).
- Canonical working examples: `examples/shadowmapping/` (static),
  `examples/skinninggltf/` (skinned + IBL self-shadow + contact-shadow floor).
