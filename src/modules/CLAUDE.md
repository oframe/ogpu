# src/modules — standalone modules

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

---

## Orbit.js

Straight port of three.js OrbitControls. No engine-specific gotchas.

## Raycast.js

Triangle testing reads CPU-side attribute data. Indirect / instanced / vertex-pulled meshes
(splats, voxels, skinned geometry) can only resolve at bounds level — and only when
`geometry.bounds` has been explicitly set. Without bounds those meshes are invisible to
the caster entirely. Set `geometry.raycast = 'sphere'` to prefer sphere over the default
AABB when both exist.

`mesh.hit` is a reused object — don't hold a reference across frames; copy what you need.

## GUI.js

`gui.uniform(target, key)` maintains a local proxy object, calls
`target.uniforms.set({[key]: value})` and writes the buffer to the GPU on every
Tweakpane change. `target` is any object owning `.uniforms` + `.uniformBuffer` +
`.gpu` — a `Mesh`, or any pass owning its own uniform buffer — NOT a `RenderPipeline`
(pipelines no longer own uniforms). Scalar uniforms (length-1 typed-array view) are
unwrapped to a number for the proxy; vec uniforms stay arrays. The `opts` object is
passed straight through to Tweakpane, so `min`/`max`/`step`/`options` all work.

`gui.folder(title)` returns a new `GUI` instance wrapping a Tweakpane FolderApi — you can
chain `.uniform`/`.add`/`.button` on it normally.

## Animation.js

`animation.fps(n)` must be called before `update()` — it throws if `_fps` is null.
The call is chainable (returns `this`).

`elapsed` is in frames, not seconds. Advance it yourself: `anim.elapsed += deltaTime * anim.fps()`.
`duration` = total frame count; `loop: true` wraps via `elapsed % duration`.

`update()` interpolates between `frame` and `frame+1` with slerp/lerp — the last frame
blends back into frame 0 when looping, which is intentional. Drive `elapsed` to exact
integers to avoid that blend.

## GLTFLoader.js

`dataOnly: true` skips all GPU work (no pipelines, textures, materials). Required when
you only want geometry/skin/animation data — e.g. feeding `../core/skin/Skin`.
Passing `code`/`iblEntries` with `dataOnly` is silently ignored.

Rig shape: bone order == `skin.joints` order, so JOINTS_0 indices map straight to bone
indices. glTF `inverseBindMatrices` **are read and used** when the skin declares them —
`../core/skin/Skin` writes them straight into `invBoneMatrixBuffer` as authoritative
bind-inverse. FK-derivation from the bind pose is only the fallback for hand-built rigs
that ship no `inverseBindMatrices`. The two sources are NOT interchangeable — don't assume
FK.

`skeletonAncestors` captures non-joint ancestor nodes above the root joint (Blender
armature objects, Mixamo's "Neo_Reference"). These are wired as animatable transforms
inside `Skin` because root motion is often authored there rather than on the hips —
freezing them drops the whole character's translation.

Skinned meshes set `frustumCulled = false` — their positions come from the Skin compute
pass, not the bind-pose attribute, so bounding sphere tests would be wrong.

`getSkinData(mesh|index)` → data for `new Skin(gpu, {data})`
`getAnimation({animation, skin, fps})` → data for `new Animation({data})`

## pbr/

Shaders only — no JS. Import via `?raw`. Entry points: `pbr.wgsl` (material shading),
`brdflut.wgsl` (BRDF LUT compute), `display.wgsl` (fullscreen present). `pbrprev.wgsl` is
legacy. Consumed by `examples/gltf/` and `examples/pbrshader/`. The IBL-build shaders
(GGX prefilter, equirect/oct unpack) live next to their only consumer in
`@utils/IBLUtils/` — see that dir's CLAUDE.md.

`pbr.wgsl` exposes an `override roughnessLevels : f32` (default `6.0`) — the prefiltered
specular cube's mip count, mapping roughness `[0,1]` → lod `[0, roughnessLevels-1]`. It
must match the IBL build's mip count: `loadIBLCubeMap` returns `mipLevels`, so consumers
pass `constants: { roughnessLevels: ibl.mipLevels }` to the `RenderPipeline`/`GLTFLoader`.
Leave it unset only if you still build the legacy 6-level cube.

## CubeMap.js

Not a stub — functional. Takes 6 face sources in WebGPU/D3D cube order (+X -X +Y -Y +Z -Z).
`await cubemap.ready` before binding. Bind `cubemap.view` as `texture_cube<f32>` in WGSL.
No mip generation by default; set `mips: true` to enable (uses webgpu-utils `generateMipmap`
via `Texture` internals).

## VideoTexture.js

Uses `requestVideoFrameCallback` when available (Chrome) to avoid redundant uploads on
fast rAF loops; falls back to `requestAnimationFrame` on older Safari/Android WebViews.
The cancel call differs between the two paths — tracked internally, no caller action needed.

iOS Safari ignores `loop` on inline muted video — fires `ended` and freezes. The class
handles this with a manual rewind on the `ended` event when it owns the video element.

`ready` resolves once metadata is loaded and the texture is sized. If the video resolution
changes at runtime (adaptive stream), the `GPUTexture` is destroyed and recreated — any
bind group holding the old view is stale and must be rebuilt. `ready` only resolves once;
there's no resize event, so poll `vt.texture` or rebuild defensively if your source can
change dimensions.
