---
name: scaffold-app
description: Scaffold a new OGPU example/app from scratch — a Renderer + Camera + Orbit + update loop and a single spinning cube wired through the vanilla Box primitive -> RenderPipeline -> Mesh setup. Use whenever the user wants a new OGPU example, a base/starter scene, a blank WebGPU sketch in this repo, "scaffold an app", "new example called X", "boilerplate a OGPU scene", "set me up a starting point", or just "new scene"/"new example" when OGPU is the implied target. Generates the example class + shader and wires it into src/main.js so it boots at ?view=<name>.
---

# Scaffold a OGPU example

Stand up a complete, runnable OGPU example: renderer boot, camera + orbit
controls, an update loop, and one spinning cube built the canonical way —
`new Box(gpu)` → `new RenderPipeline(...)` → `new Mesh(...)`. The point is a
clean, idiomatic starting point the user immediately builds on, not a finished
piece.

A shell script generates the two files (class + shader); you wire it into
`src/main.js` afterward. The split exists because file generation is fixed
boilerplate (delegate it) but the `main.js` edits are structured insertions into
an existing file (do them precisely with Edit).

## Workflow

1. Get the example name. It's used verbatim as the class name; the directory and
   `?view=` value are its lowercased form. Convention here is a PascalCase class
   in a lowercase dir (e.g. `HelloWebGPU` in `hellowebgpu/`). If the user gives a
   casual name, PascalCase it for the class.
2. Run the generator from anywhere (it resolves the repo root itself):

    ```bash
    .claude/skills/scaffold-app/scripts/scaffold-app.sh <Name>
    ```

    It creates `examples/<name>/<Name>.js` + `examples/<name>/cube.wgsl`
    and refuses to overwrite an existing example dir (surface the error, don't
    force).

3. Wire `src/main.js` — three insertions, matching the surrounding style:
    - an `import { <Name> } from './examples/<name>/<Name>';` with the others;
    - a `case '<name>': new <Name>(); break;` in the `switch (view)`;
    - a `{ view: '<name>', label: '<Label>', folder: '<name>' },` entry in the
      `items` array inside `renderLanding()`, under the most fitting
      `{ section: '...' }` header, so it shows on the gallery landing page.
4. Validate the shader without a browser: `node scripts/validate-shaders.mjs
examples/<name>/cube.wgsl` (runs `naga`). The generated cube always
   passes; re-run after any edits.
5. Tell the user it boots at `?view=<name>` (`npm run dev`, then
   `http://localhost:5173/?view=<name>`).

## What the generated class does

- `constructor({ el } = {})` → async `init` that awaits `renderer.ready`, then
  grabs `this.gpu = renderer.gpu` (the OGPU gpu context — never the raw
  device).
- `Camera` + `Orbit`, a `Transform` scene root.
- Vanilla mesh: `Box` geometry → `RenderPipeline` (pure compiled state, serves
  layouts only) → `Mesh`, parented to the scene. `Mesh` REQUIRES `bindGroups`:
  the template passes a factory `(uniformBuffer) => [...]` that builds group(0)
  against `pipeline.bindGroupLayout(0)` and binds the mesh's own uniform buffer
  at binding 0.
- Drives the loop via `this.gpu.renderer.add(this.update)` — OGPU owns the
  rAF tick and calls back with `{ time, deltaTime }`. The cube spins in
  `update`, which then calls `renderer.render({ scene, camera })`.
- `cube.wgsl` outputs the normal mapped to 0..1 (a clear, lighting-free default
  that confirms geometry + transforms are correct).

## Extending from here

Once it runs, common next steps the user may want — drop in `GUI` (Tweakpane
wrapper) for params, swap the Box for another `@core/primitives` shape, give the
shader custom uniforms/textures (see the `scaffold-shader` skill for the WGSL
conventions), or add more meshes to the scene.

## Reference

- `scripts/scaffold-app.sh` — the generator (class + cube shader). Edit this
  script, not inline copies, if the template needs to change.
- Canonical examples to mirror for more advanced setups:
  `examples/hellowebgpu/HelloWebGPU.js` (bare cube + GUI + texture),
  `examples/rendertotexture/RenderToTexture.js` (the `renderer.add`
  loop + `el`-or-`getElementById` boot this template follows).
