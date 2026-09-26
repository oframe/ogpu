# JS wiring for a scaffolded shader

Both variants assume `gpu` (`renderer.gpu`) and a `scene` Transform exist, and
the shader was imported raw:

```js
import { RenderPipeline, Mesh } from 'ogpu';
import { Box } from '@core/primitives';
import myShader from './my.wgsl?raw';
```

The ownership split to keep straight: `RenderPipeline` is **pure compiled
state** — it owns the shader module, reflected `defs`, and the vertex layout,
nothing else. It can be shared across many meshes. Each `Mesh` owns its
structured uniform view (`mesh.uniforms`, built from the pipeline's reflected
`Uniforms` struct) and its bind groups, but no uniform buffer: `mesh.uniformResource`
is a `{buffer, offset, size}` slice of the renderer's shared per-draw buffer. So
`Mesh` REQUIRES a `bindGroups` argument — a `GPUBindGroup[]` or a factory
`(uniformResource) => GPUBindGroup[]` that receives that slice to bind verbatim
at group(0)/binding(0). Build groups against `pipeline.bindGroupLayout(i)`.

## No texture (short path)

```js
const geometry = new Box(gpu);

const pipeline = new RenderPipeline(gpu, {
    label: 'my-shader',
    code: myShader,
    vertexBuffers: geometry.bufferLayouts,
    cullMode: 'back',
});

const mesh = new Mesh(gpu, {
    label: 'my-mesh',
    pipeline,
    geometry,
    bindGroups: (uniformResource) => [
        gpu.device.createBindGroup({
            layout: pipeline.bindGroupLayout(0),
            entries: [{ binding: 0, resource: uniformResource }],
        }),
    ],
});

// custom uniforms — names must match the WGSL Uniforms struct
mesh.uniforms.set({ uScale: 1.0 });

mesh.setParent(scene);
```

Standard uniforms (matrices/time/resolution) are written and uploaded by
`Mesh.draw` every frame; `mesh.uniforms.set({...})` is for the custom fields.

## With a texture

Keep the texture lines in the `.wgsl` (`mySampler` + `tMap`), then add the
sampler/texture entries to the bind group — the bindings get resolved by name
via reflection on `pipeline.defs`:

```js
const geometry = new Box(gpu);

const pipeline = new RenderPipeline(gpu, {
  label: 'my-shader',
  code: myShader,
  vertexBuffers: geometry.bufferLayouts,
  cullMode: 'back',
});

// however you obtain the texture — e.g. device.createTexture + writeTexture
const texture = /* GPUTexture */;

const mesh = new Mesh(gpu, {
  label: 'my-mesh',
  pipeline,
  geometry,
  bindGroups: (uniformResource) => [
    gpu.device.createBindGroup({
      layout: pipeline.bindGroupLayout(0),
      entries: [
        { binding: 0, resource: uniformResource },
        {
          binding: pipeline.defs.samplers.mySampler.binding,
          resource: gpu.device.createSampler(),
        },
        {
          binding: pipeline.defs.textures.tMap.binding,
          resource: texture.createView(),
        },
      ],
    }),
  ],
});

mesh.uniforms.set({ uScale: 1.0 });

mesh.setParent(scene);
```

After a texture resize/recreate the old views are stale — rebuild the affected
group against `pipeline.bindGroupLayout(0)` (use `mesh.uniformResource` for
binding 0) and assign it back to `mesh.bindGroups[0]`.
