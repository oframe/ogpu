# Changelog

## 0.1.3

### Changed

- **`webgpu-spec-lookup` skill — W3C spec lookups now run against a cached,
  preprocessed local copy instead of a `WebFetch` per question.** A new
  `update_spec.py` downloads `https://www.w3.org/TR/webgpu/` at most once per day
  (re-fetching only when the cached copy's date differs from today), strips it to
  ~628 KB of greppable text (from 4.5 MB of HTML), and prefixes every heading with
  its `[#anchor]` so a grep hit traces straight back to a spec section.

  **Benefits:** spec answers go from a slow, lossy whole-page fetch to a near-instant
  local `grep` — exact identifiers and limit values (`GPUFeatureName`,
  `GPUSupportedLimits`, default limits) come back verbatim instead of summarized, and
  repeat lookups in a session reuse the same-day cache. Chrome "What's New" lookups
  still use `WebFetch`. The downloaded cache (`webgpu-spec.txt`) is gitignored.
