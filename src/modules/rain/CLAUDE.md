# src/modules/rain — rain streaks + ripple field

Composition over `../particles/ParticleSystem` — read that dir's CLAUDE.md
first; the sim invariants live there. Rain adds nothing to the sim itself: it
enables the particles module's wrap volume, drives `wrap.center` (and the
emitter position) from the camera each frame, and modulates wind with a gust
sinusoid. Density = `rate * life` steady state, so preset switches converge
over ~life seconds instead of resetting (deliberate: no visual pop).

## RippleField (ripples.wgsl)

- 512² `rgba16float` storage texture: **xy = height gradient, z = height**.
  The gradient is analytic (differentiated ring packet), not a finite
  difference of the height channel — don't "fix" it by re-deriving from z.
- Ring buffer (~256) of `{posXZ, birthTime}` impacts; `rippleSpawn` (single
  thread) overwrites oldest slots at a statistically accumulated rate,
  `rippleEval` sums every active ring per texel as an expanding damped
  sinusoid. Heavy rain overflows the ring early — oldest ripples vanish
  sooner, which reads as churn, not a bug.
- Distances are **toroidal** in the tile, so it repeats seamlessly under a
  repeat sampler. Keep tile-relative positions in [-worldSize/2, worldSize/2].
- `amplitude` is a unitless strength; the consumer scales the gradient.

## Consuming tRipple in a ground shader

Bind `rain.tRipple` as `tRipple` plus a **repeat** sampler, pass
`rain.rippleWorldSize`:

```wgsl
// fragment stage — worldPos from the vertex stage, up-facing ground
let rippleUv = worldPos.xz / uniforms.rippleWorldSize;
let ripple = textureSample(tRipple, rippleSampler, rippleUv);
// xy = height gradient: bend the up normal against it
let strength = 1.0; // consumer-side scale
var n = normalize(vec3f(-ripple.x * strength, 1.0, -ripple.y * strength));
// optional: ripple.z (height) as a subtle brightness/spec modulation
let wet = 1.0 + ripple.z * 0.15;
```

For non-flat receivers blend `n` into the surface normal (e.g.
`normalize(mix(surfaceN, n, wetness))`) instead of replacing it.

## Traps

- `rippleEval` writes every texel every frame (storage texture, `write`
  access) — there is no accumulation; ripples exist only while their ring
  entry is younger than `maxAge`.
- The two ripple kernels need different bind groups (`rippleSpawn` never
  binds the texture; `rippleEval` never binds the head counter) — auto
  layouts only contain statically-used bindings.
- `RainSystem.update` creates ONE encoder for particles + ripples when none
  is passed; pass your own encoder to chain everything into a single submit.
- The wrap volume recycles streaks instantly, so emission fills the whole box
  (emitter box == wrap box) rather than raining down from a top plane —
  a fresh scene starts full, no warm-up.
