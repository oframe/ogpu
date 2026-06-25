---
name: scaffold-shader
description: Scaffold a new simple WGSL shader for the OGPU engine, wired for a RenderPipeline + Mesh. Use whenever the user wants to create a new shader, start a shader from scratch, add a .wgsl file for a mesh, get a shader boilerplate/template/starting point, or "make me a basic shader" / "scaffold a shader". Produces a minimal vs/fs WGSL file following the engine's reflection conventions, optionally with the JS pipeline wiring.
---

# Scaffold a simple WGSL shader

Generate a minimal, correct WGSL file (plus optional JS wiring) for a mesh
rendered through `RenderPipeline` + `Mesh`. The base shader is deliberately bare
— vs/fs with the standard transform uniforms and a fragment that outputs the
normal mapped to 0..1. No custom uniforms, no textures: those are modifications
you layer on top after generating, per the task. The reference shape is
`examples/hellowebgpu/cube.wgsl` (same conventions).

## Conventions that are NOT optional (reflection-enforced)

These come from `webgpu-utils` reflection in `RenderPipeline`/`Mesh` — get one
wrong and the pipeline silently shades garbage or fails construction:

- Uniform block MUST be `@group(0) @binding(0) var<uniform> uniforms : Uniforms`.
  Lowercase `uniforms`, struct typed (commonly `Uniforms`). `RenderPipeline`
  reads `this.defs.uniforms.uniforms` by that exact name.
- Vertex entry point MUST be `vs`, fragment MUST be `fs`. Hardcoded.
- `Mesh.draw` writes standard uniforms BY NAME into the struct — only the fields
  that exist are written. Available: `projectionMatrix`, `viewMatrix`,
  `modelViewMatrix`, `modelMatrix`, `objectMatrix` (inverse model),
  `normalMatrix` (mat3x3f), `cameraPosition` (vec3f), `cameraQuaternion` (vec4f),
  `resolution` (vec2f), `time` (f32). Declare only the subset the shader uses,
  spelled exactly. Custom uniforms (e.g. `uScale`, `uAlpha`) go after them and
  are set via `mesh.uniforms.set({...})` — the `Mesh` owns the uniform buffer,
  not the pipeline.
- Vertex attribute `@location` is assigned by declaration ORDER in the
  geometry's `data` object, not by name. Standard primitives (`@core/primitives`
  `Box`/`Sphere`/…) emit `position` (loc 0), `normal` (loc 1), `uv` (loc 2).
  The `Vertex` struct must match that order.
- Texture uniforms are named `t<Name>` (e.g. `tMap`). Samplers keep descriptive
  names. Only add these if the shader actually samples a texture — a declared
  binding with no bind-group entry throws at pipeline creation.

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
      # --std projectionMatrix,modelViewMatrix,normalMatrix,time  # override std fields
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
    - custom uniforms go AFTER the standard fields in `Uniforms`, set via
      `mesh.uniforms.set({...})`;
    - textures are `t<Name>` + a sampler at the next free `@binding`, and need a
      matching bind-group entry (see `references/js-wiring.md`).
4. Validate the WGSL without a browser — `node scripts/validate-shaders.mjs
<file>` runs `naga`. The freshly-generated base always passes; run it again
   after your edits to catch syntax/type errors before the user loads the page.
   (If `naga` is absent the script exits 2 — `brew install naga`.)
5. If JS wiring requested, write it from `references/js-wiring.md` (no-texture
   variant is the short path; texture variant adds the sampler/texture bind-group
   entries via `pipeline.defs.samplers.*` / `pipeline.defs.textures.*`).
6. Tell the user how to render it: `new RenderPipeline(gpu, { code,
vertexBuffers: geometry.bufferLayouts })` → `new Mesh(gpu, { pipeline,
geometry, bindGroups })` → `mesh.setParent(scene)`. The `Mesh` REQUIRES a
   `bindGroups` factory (pipeline serves layouts only — see
   `references/js-wiring.md`). Custom uniforms set with `mesh.uniforms.set({...})`
   (Mesh.draw uploads each frame).
7. Hot reload works automatically — every `src/**/*.wgsl` is an HMR boundary, so
   editing the new file reloads the pipeline live (`ShaderReload`).

## References

- `scripts/scaffold.py` — the generator. Emits the bare vs/fs base
  (normal→0..1); flags: `--out`, `--std`, `--force`.
- `references/shader-template.wgsl` — annotated reference of the shape the
  script emits (read it to understand the output, not to hand-copy it).
- `references/js-wiring.md` — pipeline + mesh wiring, no-texture and texture
  variants.
