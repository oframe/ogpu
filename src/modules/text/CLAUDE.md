# src/modules/text — MSDF text + SplitText-style reveals

Signatures live in repo-root `api-digest.md`. Worked example: `examples/msdftext/`
(`?example=msdftext`).

## Atlas generation is offline

msdfgen does the distance fields; its front-end **msdf-atlas-gen** packs the atlas and
writes the json `MSDFFont` reads. `npm run build:font` (`scripts/build-msdf-font.mjs`)
rebakes the bundled Instrument Serif. There's no prebuilt macOS binary, so the script header
has the cmake line (vcpkg/Skia off, Homebrew freetype + libpng). Fonts committed under
`public/assets/fonts/<name>/` must be redistributable and ship their licence (`OFL.txt`).

- **`-type mtsdf`, not msdf.** RGB = multi-channel distance (median → sharp corners), A =
  true sdf. Outline and blur read A: the median wobbles away from the edge.
- **`pxrange` caps every effect.** The field only exists pxRange/2 atlas px out from the
  edge, so outline/blur saturate at `font.padEm` em (0.142 for the bundled font). A wider
  effect hits a hard rim where the field runs out. Need more → rebake with a bigger range,
  and accept fewer px/em (`-minsize` fills the same POT atlas).
- **Kerning comes from the legacy `kern` table only** (FreeType). GPOS-only fonts, which is
  most modern ones including Instrument Serif, bake `kerning: []`. That's not a loader bug.

## Loading

`MSDFFont.load` decodes the png itself with `premultiplyAlpha: 'none'`. A default decode
premultiplies, which multiplies the msdf channels by the true-sdf alpha and wrecks the field
wherever alpha < 1. The texture is `rgba8unorm` (never srgb, it's distance data), with no
mips: minified mips bleed neighbouring glyph fields into each other.

`new MSDFFont(gpu, { json, image })` takes the `src` path of `Texture`, so `font.texture` has
no GPU texture until `font.ready` resolves; an MSDFText built before that throws on
`createView`. Use `MSDFFont.load`, or `await font.ready`.

`-yorigin top` atlases are normalised on load. Glyph planes are y-up em, uvs top-down.
`planeBounds` include the sdf margin; **ink = plane inset by `padEm`**, which is what the
char/word/line boxes hug.

## MSDFText

One instanced quad per glyph, all six per-glyph vec4s interleaved into one buffer. One
`Shader` per device (the cache key holds `shader.id`), so every MSDFText shares a pipeline
per pass kind and `depthTest` setting: the atlas is a bind group resource, and every text
has the same vertex layout. Pass formats come from the pass, so there's no
`targets`/`sampleCount`/`pipeline` option; `shader` swaps in a variant (same bindings).

- `transparent`, **`depthWrite: false`**: kerned glyphs and their sdf margins overlap at one
  z and would clip each other. `cullMode: 'none'` because per-unit flips show back faces.
- Each text owns a `UniformBuffer` (`text.uniforms`) and one bind group of
  `{ uniforms, atlasSampler, tMap }`. The engine block is groups 1 (camera/object) and 3 (time).
- `setText` rebuilds the `Geometry` (instance count changes) with the same layout, so the
  bind group and the cached pipeline survive. Empty text keeps a one-glyph dummy buffer and
  `draw()` skips it.
- `destroy()` frees the geometry, the uniform buffer and the engine slot, not the shared
  shader or the font, and settles a pending `play()`. Remove the text from the scene first:
  unlike a plain Mesh it can't draw again.
- Device restore: new texts get a fresh shader (keyed on `gpu.device`), existing ones and
  the font are dead. Reload the font and recreate the texts in
  `renderer.addDeviceRestoredHandler`.
- Instanced, so the culler can't derive extents. `geometry.bounds` is set from the layout
  box, padded by how far the current `from` state can throw a glyph (recomputed in
  `animate`).
- Don't put a text under a `RecordedGroup`: the replay skips `MSDFText.draw()`, so the reveal
  clock never advances (and the empty-text skip doesn't run).
- The class is `MSDFText`, not `Text`: `Text` is the DOM text-node global, and a missed
  import would silently construct a DOM node.

## Reveal model

Everything per-glyph is in `text.wgsl`'s `vs`, and the CPU writes one uniform per frame.

- **Stagger unit and mask unit are independent** (`split` vs `mask`): chars rising inside
  line masks is the canonical SplitText look. Every unit spans its line's height (like
  inline-block chars in the DOM), which is why `yPercent: -100` exactly clears a line mask.
- **y is up.** gsap's `yPercent: 100` ("start below") is `yPercent: -100` here.
- Mask boxes grow by `uOutline * uEm` (uEm = layout size). Boxes hug the ink, so without
  that an outlined glyph at rest is clipped flat at its line's edges.
- The mask is overflow-hidden in layout space. The _animated_ position is tested against
  the _static_ box, which is what makes a slide clip. The wipe is clip-path in the unit's own
  box at rest, driven by the unit's eased t.
- Glyphs of one word/line share that unit's box, so they share pivot (`origin`) and
  `x/yPercent`. A word rotates as one piece, not per glyph.
- `order` is evaluated in the shader from unit index + count. `totalDuration` is
  `duration + stagger * maxOrder`, where maxOrder is half for center/edges. Change one side
  and you must change the other.
- Effects are multipliers on alpha, never branches. `textureSample` and both `fwidth`s
  stay in uniform control flow.
- The clock: the first `draw()` of each frame advances `play()`/`reverse()` by
  `renderer.deltaTime` (draw args carry the renderer; a repeat draw in the same frame, same
  `renderer.time`, adds nothing). It's the renderer's clock, so a paused renderer or one
  driven outside `Renderer.update` freezes playback — set `autoUpdate = false` and call
  `update(dt)` yourself there. **Playback only advances while the text is drawn**: hidden or
  frustum-culled text pauses (a frame delta, not the time since the last draw, so it
  doesn't jump ahead when it reappears). Setting `progress` or calling
  `animate` stops playback and settles the pending `play()` promise.
- `setText` re-derives `totalDuration` + cull bounds from the new counts and keeps the
  playhead's fraction. A new `size` doesn't rescale the `from` x/y/z offsets (em, baked by
  `animate`); call `animate` again after a size change. The stagger span grows with the unit count, so a longer string
  plays longer.
