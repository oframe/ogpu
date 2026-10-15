---
name: scaffold-shader
description: Scaffold a new simple WGSL shader for the OGPU engine, wired for a Shader + Mesh. Use whenever the user wants to create a new shader, start a shader from scratch, add a .wgsl file for a mesh, get a shader boilerplate/template/starting point, or "make me a basic shader" / "scaffold a shader". Produces a minimal vs/fs WGSL file following the engine's reflection conventions, optionally with the JS Shader/Mesh wiring.
---

# Scaffold a simple WGSL shader

Generate a minimal, correct WGSL file (plus optional JS wiring) for a mesh
rendered through `Shader` + `Mesh`. The base shader is deliberately bare
— vs/fs reading the engine's `camera.*`/`object.*` and a fragment that outputs the
normal mapped to 0..1. No custom uniforms, no textures: those are modifications
you layer on top after generating, per the task. The reference shape is
`examples/hellowebgpu/cube.wgsl` (same conventions).

## Conventions that are NOT optional

These come from the reflection in `Shader` — get one wrong and the draw
silently shades garbage or fails construction:

- Line 1 is `// validate-prepend: <relative path to src/core/engine.wgsl>` so
  `validate-shaders` can compile the file (the script computes the path).
- Do NOT declare matrices/time/resolution in a `Uniforms` struct. `Shader`
  appends the engine block (`src/core/engine.wgsl`): `@group(1) camera`
  (`projectionMatrix`, `viewMatrix`, `cameraPosition`, `time`,
  `cameraQuaternion`, `resolution`; one slot per render()) and `@group(1) object`
  (`modelMatrix`, `normalMatrix` (mat3x3f), `objectMatrix` (inverse model); one
  fixed slot per mesh). Read `camera.*` / `object.*`. There is no stored modelView;
  per vertex write
  `camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * p))`
  (WGSL `*` is left-associative, so `P * V * M * p` does mat-mat products per
  vertex). `modelViewMatrix()` returns the matrix where code needs it. Don't
  use `camera`/`object`/`Camera`/`Object`/`modelViewMatrix` as other
  module-scope names. group(1) is the engine's — user resources go in group 0
  (groups 2–3 for extras).
- Custom uniforms: `@group(0) @binding(0) var<uniform> uniforms : Uniforms`
  (lowercase `uniforms`, struct typed; `shader.uniforms` is that struct). Own
  them with a `UniformBuffer` and `set({...})`.
- Vertex entry point MUST be `vs`, fragment MUST be `fs`. Hardcoded.
- Vertex attribute `@location` is assigned by declaration ORDER in the
  geometry's `data` object, not by name. Standard primitives (`@core/primitives`
  `Box`/`Sphere`/…) emit `position` (loc 0), `normal` (loc 1), `uv` (loc 2).
  The `Vertex` struct must match that order.
- Texture uniforms are named `t<Name>` (e.g. `tMap`). Samplers keep descriptive
  names. Only add these if the shader actually samples a texture — a binding used
  by `vs`/`fs` but missing from the bind group fails bind-group validation.

## Workflow

1. Ask/confirm only what changes the output (skip if obvious from the request):
    - Shader name / target file path (default: alongside the consuming JS, e.g.
      `examples/<name>/<name>.wgsl`, or `./<name>.wgsl` next to the caller).
    - Does it need the JS pipeline wiring too, or just the `.wgsl`? Default: just
      the `.wgsl` unless they're clearly starting a new example.
2. Generate the base `.wgsl` by RUNNING the scaffold script — don't hand-write
   the boilerplate. The script emits a guaranteed-correct vs/fs skeleton with
   the bindings/struct/attribute order already right, so you spend your effort
   on the task-specific shading, not on re-deriving reflection rules:

    ```bash
    python .claude/skills/scaffold-shader/scripts/scaffold.py \
      --out examples/<name>/<name>.wgsl \
      # --uniforms uScale:f32,uTint:vec3f  # add a custom Uniforms struct (default: none)
      # --force                   # overwrite an existing file
    ```

    It refuses to clobber an existing file unless `--force`. Run `scaffold.py -h`
    for the full flag list.

3. Layer the requested modifications ON TOP of the generated file with Edit —
   the script output is a bare starting point (normal→0..1 fragment), not the
   finished shader. This is where the user's actual intent lands: custom
   uniforms, textures, custom fragment math, extra varyings, displacement in the
   vertex stage, sampling logic, etc. Keep the reflection conventions intact
   while you edit:
    - custom uniforms go in a `Uniforms` struct at group 0 binding 0, owned by a
      `UniformBuffer` and set via `uniforms.set({...})`;
    - textures are `t<Name>` + a sampler at the next free `@binding`, and need a
      matching bind-group entry (see `references/js-wiring.md`).
4. Validate the WGSL without a browser — `node scripts/validate-shaders.mjs
<file>` runs `naga`. The freshly-generated base always passes; run it again
   after your edits to catch syntax/type errors before the user loads the page.
   (If `naga` is absent the script exits 2 — `brew install naga-cli` (not `naga`), or `cargo install naga-cli`.)
5. If JS wiring requested, write it from `references/js-wiring.md` (no-texture
   variant is the short path; texture variant adds the sampler/texture by WGSL
   name in `shader.createBindGroup`).
6. Tell the user how to render it: `new Shader(gpu, { label, code })` →
   `new Mesh({ label, geometry, shader, state, bindGroups: [shader.createBindGroup(0,
{...})] })` → `mesh.setParent(scene)`. A `Mesh` takes no `gpu` and no
   pipeline (the renderer derives it from shader + `state` + the pass); custom
   uniforms live in a `UniformBuffer` (`set` uploads immediately). See
   `references/js-wiring.md`.
7. Hot reload works automatically — every `*.wgsl?raw` import is an HMR boundary, so
   editing the new file reloads the pipeline live (`ShaderReload`).

## References

- `scripts/scaffold.py` — the generator. Emits the bare vs/fs base
  (normal→0..1); flags: `--out`, `--uniforms`, `--force`.
- `references/shader-template.wgsl` — annotated reference of the shape the
  script emits (read it to understand the output, not to hand-copy it).
- `references/js-wiring.md` — shader + mesh wiring, no-texture and texture
  variants.
