# src/modules/text — MSDF text

Signatures live in repo-root `api-digest.md`. This file is gotchas only.

- **Atlas generation is offline**: `npm run font -- <ttf> [--size 42] [--range 4] [--charset file] [--name out]`
  (scripts/generate-msdf.mjs, msdf-bmfont-xml) → committed PNG + BMFont JSON
  under `public/assets/fonts/`. `roboto` ships as the default. Atlas-size
  guidance: ASCII at size 42 → 512px-class atlas; hero type wants `--size 64+`
  (crisper huge glyphs, bigger atlas). `distanceRange` must reach the shader —
  `MSDFFont` reads it from the JSON and `Text` feeds it as `uPxRange`; don't
  hardcode.
- **`Text.set()` recreates the geometry** (buffers are static). Fine for
  counters/labels each frame; a novel-length relayout per frame is CPU churn.
  `frustumCulled` is forced off because bounds go stale across swaps.
- **The shader's AA is the whole point**: `fwidth`-scaled screen-px range —
  never replace with a fixed smoothstep or text shimmers at scale/perspective.
  Output is straight alpha through the engine's `transparent: true` blending;
  near-zero alpha discards to keep depth clean. `depthWrite` defaults off
  (sorted in the transparent bucket).
- **Billboard mode** replaces the modelView rotation with identity
  (translation kept, model rotation/scale ignored) — anchor text to moving
  objects; don't expect nested-scale support.
- **uv space**: atlas pixel coords / atlas size, y-down — matches WebGPU
  texture space directly, no flip anywhere in this module.

## When MSDF is the wrong tool

- Accessibility/SEO-critical copy → HTML/CSS overlay (userland pattern).
- Extruded/3D-displaced hero headlines → glyph triangulation offline.
- Tiny dynamic labels with arbitrary unicode → canvas-texture sprite.
  MSDF wins for crisp scalable in-scene text — one texture, quads, fill-rate
  cost only.
