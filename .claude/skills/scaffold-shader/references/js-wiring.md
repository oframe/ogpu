# JS wiring for a scaffolded shader

Both variants assume `gpu` (`renderer.gpu`) and a `scene` Transform exist, and
the shader was imported raw:

```js
import { Shader, UniformBuffer, Mesh, Box } from 'ogpu';
import myShader from './my.wgsl?raw';
```

The ownership split to keep straight: `Shader` holds the compiled module and
reflected layouts (and appends the engine block, so `camera.*`/`object.*` just
work at group(1)). `state` is a plain frozen object (`cullMode`, `transparent`,
`depthWrite`, `blending`, …) — replace it, don't mutate it. The renderer derives
the `GPURenderPipeline` from shader + state + geometry layout + the pass's
formats, so a `Mesh` takes no `gpu`, no pipeline, and no targets. Bind groups
are built by WGSL name with `shader.bindGroupLayout(group).createBindGroup({ name: resource })`;
group(1) is the engine's, so `bindGroups[1]` stays empty.

## No texture (short path)

```js
const geometry = new Box(gpu);
const shader = new Shader(gpu, { label: 'my-shader', code: myShader });

// only if the WGSL declares `var<uniform> uniforms : Uniforms`
const uniforms = new UniformBuffer(gpu, shader.uniforms, { uScale: 1.0 });

const mesh = new Mesh({
    label: 'my-mesh',
    geometry,
    shader,
    state: { cullMode: 'back' },
    bindGroups: [shader.bindGroupLayout(0).createBindGroup({ uniforms })],
});

// custom uniforms — names must match the WGSL Uniforms struct; uploads immediately
uniforms.set({ uScale: 2.0 });

mesh.setParent(scene);
```

A base scaffold with no `Uniforms` struct needs no `UniformBuffer` and no
`bindGroups` at all.

## With a texture

Keep the texture lines in the `.wgsl` (`mySampler` + `tMap`), then add them to
the bind group by WGSL name:

```js
const geometry = new Box(gpu);
const shader = new Shader(gpu, { label: 'my-shader', code: myShader });
const uniforms = new UniformBuffer(gpu, shader.uniforms, { uScale: 1.0 });

// however you obtain the texture — e.g. device.createTexture + writeTexture
const texture = /* GPUTexture */;

const mesh = new Mesh({
    label: 'my-mesh',
    geometry,
    shader,
    state: { cullMode: 'back' },
    bindGroups: [
        shader.bindGroupLayout(0).createBindGroup({
            uniforms,
            mySampler: gpu.device.createSampler(),
            tMap: texture.createView(),
        }),
    ],
});

mesh.setParent(scene);
```

Unknown names throw; a declared name that `vs`/`fs` never use is dropped. After a
texture resize/recreate the old views are stale — rebuild the group and assign it
back: `mesh.bindGroups[0] = shader.bindGroupLayout(0).createBindGroup({ uniforms, mySampler, tMap: fresh.createView() })`.
