---
name: webgpu-spec-lookup
description: Ground any answer about the WebGPU platform itself — browser support/compatibility, feature availability, limits, what's shipping or behind a flag, and exact spec behavior — in the live Chrome WebGPU docs and the W3C spec before responding, instead of answering from memory. Use whenever a question is about WebGPU as a platform rather than OGPU's own code: "is X supported in Chrome/Safari/Firefox", "are 64-bit atomics available", "what's the default maxStorageBufferBindingSize", "does WebGPU have feature Y yet", "what's new in WebGPU", "is timestamp-query / shader-f16 / float32-filterable shipping", origin-trial/flag status, or whether some API is in the spec at all. WebGPU moves fast and memory goes stale — fetch the sources first.
---

# Answer WebGPU-platform questions from the live docs, not from memory

WebGPU is a moving target: features ship per Chrome milestone, limits get raised,
things sit behind flags or origin trials, and the spec adds capabilities on a
rolling basis. Whatever you recall about "is X supported" or "what's the default
limit" is liable to be months stale, and a confident wrong answer about browser
support or a feature name wastes the user's time. The cost of fetching is a few
seconds. So for platform questions, check the sources before answering.

This skill is for questions about **WebGPU the platform** — support, features,
limits, spec behavior. It is NOT for questions about OGPU's own engine code
(that's the codebase) or the `webgpu-utils` library (that's the
`webgpu-utils-lookup` skill).

## Sources

Always consult these two with WebFetch; they answer different things:

1. **Chrome WebGPU docs / "What's New" — reality of what's shipped.**
   <https://developer.chrome.com/docs/web-platform/webgpu>
   This is the entry point; the per-release "What's New in WebGPU (Chrome NNN)"
   posts are where feature-shipping, flags, origin trials, and raised limits are
   announced. The landing page links to them — if the answer needs a specific
   milestone, follow the link (or WebSearch `What's New in WebGPU Chrome` to find
   the most recent post). Use this for: "is it shipping / in which Chrome / behind
   a flag / in an origin trial", and browser-compat reality.

2. **W3C WebGPU spec — authoritative API surface.**
   <https://www.w3.org/TR/webgpu/>
   Use this for: exact feature names (the `GPUFeatureName` enum — e.g.
   `timestamp-query`, `shader-f16`, `float32-filterable`, `depth32float-stencil8`,
   texture-compression families), default and required limit values
   (`GPUSupportedLimits`), and whether a capability exists in the spec at all
   versus being a proposal. Quote the exact identifier and value.

You usually need both: the spec says what the feature is _called_ and what it
guarantees; the Chrome docs say whether it's _actually available_ and where.
Cross-browser nuance (Safari/Firefox) isn't covered by either — if the question
hinges on a non-Chrome browser, say what the spec defines and what Chrome ships,
and flag that the other browsers' status isn't in these sources (MDN/caniuse
would be needed, and the user didn't point there).

## Worked example: "are 64-bit atomics supported?"

Don't answer from memory. Fetch the spec to find the real feature name (64-bit
integer atomics are gated behind a WGSL/feature flag, not baseline), then the
Chrome "What's New" posts to see if/when it shipped or whether it's still
experimental / flagged. Report the exact `GPUFeatureName`, the Chrome status, and
that the user must feature-detect it (`adapter.features.has(...)`) — never assume
presence.

## Tie back to OGPU

When the platform answer affects engine code, connect it: `Renderer.initDevice`
(`src/core/Renderer.js`) keeps a `wantedFeatures` wishlist and feature-detects
each entry against `adapter.features` before requesting the device, dropping
(and `console.warn`-ing) anything missing — so the engine boots anywhere but
optional features may be absent at runtime. Any code path depending on a feature
you just researched must guard on `device.features.has(...)` (precedent:
`TimingHelper` gating `'timestamp-query'`). See the "Browser floor" section of
CLAUDE.md.

## How to apply what you find

- Quote exact identifiers and values from the spec (feature names, limit
  defaults) rather than paraphrasing.
- State the Chrome version / flag / origin-trial status when support is the
  question, and cite which "What's New" post it came from.
- If the sources disagree with what you half-remember, trust the sources and say
  so. If a question can't be settled from these two (e.g. Safari timeline), say
  what's missing instead of guessing.
