# Shadow mapping — copy-paste blocks

All blocks lifted from the two working examples. Adapt names; keep the
conventions (uniform block named `uniforms`, entry points `vs`/`fs`, texture
prefix `t*`).

## 1. Caster WGSL (vertex-only — no `fs`)

### Static geometry (vertex attributes)

```wgsl
struct Uniforms {
  projectionMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex { @location(0) position : vec3f }
struct VertexOutput { @builtin(position) position : vec4f }

@vertex
fn vs(v : Vertex) -> VertexOutput {
  var out : VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(v.position, 1.0);
  return out;
}
```

`Mesh.draw` writes `projectionMatrix`/`modelViewMatrix` by name from whatever
camera the caster scene is rendered with — render the caster with the LIGHT
camera and these become the light's matrices automatically.

### Skinned / compute-positioned geometry

Pull position from the same storage buffer the main vertex stage uses, indexed
by `@builtin(vertex_index)`:

```wgsl
struct Uniforms {
  projectionMatrix : mat4x4f,
  viewMatrix : mat4x4f,
  modelMatrix : mat4x4f,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> positionBuffer : array<f32>;

struct Vertex { @builtin(vertex_index) vertexIndex : u32 }

@vertex
fn vs(in : Vertex) -> @builtin(position) vec4f {
  let position = vec3f(
    positionBuffer[in.vertexIndex * 3],
    positionBuffer[in.vertexIndex * 3 + 1],
    positionBuffer[in.vertexIndex * 3 + 2]
  );
  return uniforms.projectionMatrix * uniforms.viewMatrix * uniforms.modelMatrix * vec4f(position, 1.0);
}
```

## 2. Receiver WGSL fold

### Struct + bindings (append after the receiver's existing group-0 bindings)

```wgsl
override shadowDepthTextureSize : f32 = 2048.0;

struct Shadow {
  projectionViewMatrix : mat4x4f,
  lightDirection : vec3f,
}

// pick binding indices after the shader's existing ones
@group(0) @binding(N)   var<uniform> shadowUniforms : Shadow;
@group(0) @binding(N+1) var shadowSampler : sampler_comparison;
@group(0) @binding(N+2) var shadowMap : texture_depth_2d;
```

### Vertex — emit shadow coord (needs `worldPos` and a `vShadowCoord` varying)

```wgsl
// add to VertexOutput:  @location(K) vShadowCoord : vec4f,
var shadowCoord = shadowUniforms.projectionViewMatrix * worldPos;
shadowCoord = shadowCoord / shadowCoord.w;
out.vShadowCoord = vec4f(shadowCoord.xy * vec2f(0.5, -0.5) + vec2f(0.5), shadowCoord.z, 1.0);
```

### PCF helpers (3×3 jittered)

```wgsl
fn hash22(p : vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn shadowVisibility(shadowCoord : vec4f) -> f32 {
  var visibility = 0.0;
  let texel = 1.0 / shadowDepthTextureSize;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(vec2(x, y));
      let hash = hash22(shadowCoord.xy * shadowDepthTextureSize + offset) - 0.5;
      visibility += textureSampleCompare(
        shadowMap, shadowSampler,
        shadowCoord.xy + (offset + hash) * texel, shadowCoord.z - 0.002   // <- receiver z-bias
      );
    }
  }
  return visibility / 9.0;
}
```

### Fragment — gate the light

Standard lit shader (has a punctual light already): multiply the direct term.

```wgsl
let shadow = shadowVisibility(in.vShadowCoord);
light *= shadow;
```

IBL-only shader (no punctual light): the shadow has nothing to occlude, so ADD a
directional term gated by the shadow and leave the IBL ambient alone:

```wgsl
var col = (kD * shDiffuse * albedo) + iblSpecular;   // existing IBL result
let lightDir = normalize(shadowUniforms.lightDirection);
let nDotL = max(dot(normal, lightDir), 0.0);
let shadow = shadowVisibility(in.vShadowCoord);
col += albedo * kD * nDotL * shadow;                  // direct sun, gated
```

Floor/contact receiver (just show the shadow on a flat colour):

```wgsl
let shadow = shadowVisibility(in.vShadowCoord);
let light = mix(0.75, 1.0, shadow);   // shadowed -> 0.75, lit -> white
return vec4f(vec3f(light), 1.0);
```

## 3. JS wiring

```js
import { Camera, Mesh, RenderPipeline, RenderTarget, Mat4, createUniformBuffer } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

const SHADOW_SIZE = 2048;
const SHADOW_FORMAT = 'depth32float';

// depth-only target
this.shadowBuffer = new RenderTarget(this.gpu, {
  width: SHADOW_SIZE, height: SHADOW_SIZE, depth: 1,
  color: false, depthTexture: true, depthFormat: SHADOW_FORMAT,
});

// orthographic light camera
const lightPos = [4, 8, 4];
const lightTarget = [0, 1, 0];
this.shadowCamera = new Camera({ left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 30 });
this.shadowCamera.position.set(...lightPos);
this.shadowCamera.lookAt(lightTarget);
this.shadowCamera.updateMatrixWorld();

const shadowVP = new Mat4().copy(this.shadowCamera.projectionMatrix).multiply(this.shadowCamera.viewMatrix);
const lightDir = [lightPos[0] - lightTarget[0], lightPos[1] - lightTarget[1], lightPos[2] - lightTarget[2]];
const lightLen = Math.hypot(...lightDir);

const shadowMapSampler = this.gpu.device.createSampler({
  label: 'shadow-map-sampler',
  minFilter: 'linear', magFilter: 'linear',
  addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  compare: 'less',
});

// Shadow uniform buffer — structured view off ANY receiver pipeline's defs
const shadowView = makeStructuredView(receiverPipeline.defs.uniforms.shadowUniforms);
shadowView.set({ projectionViewMatrix: shadowVP, lightDirection: lightDir.map((v) => v / lightLen) });
const shadowUniformBuffer = createUniformBuffer(this.gpu, { label: 'shadow-uniforms', size: shadowView.arrayBuffer.byteLength });
this.gpu.device.queue.writeBuffer(shadowUniformBuffer, 0, shadowView.arrayBuffer);
const shadowDepthView = this.shadowBuffer.depthTexture.createView();

// caster pipeline (note depthStencil with slope bias, no fragment stage in the WGSL)
const casterPipeline = new RenderPipeline(this.gpu, {
  label: 'shadow-caster',
  code: casterShader,
  vertexBuffers: geometry.bufferLayouts,
  depthStencil: {
    depthWriteEnabled: true, depthCompare: 'less', format: SHADOW_FORMAT,
    depthBias: 1, depthBiasSlopeScale: 1.75, depthBiasClamp: 0.0,
  },
});
this.shadowMesh = new Mesh(this.gpu, {
  label: 'shadow-caster',
  pipeline: casterPipeline,
  geometry,
  bindGroups: (uniformBuffer) => [
    this.gpu.device.createBindGroup({
      layout: casterPipeline.bindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        // skinned only: { binding: 1, resource: { buffer: skin.skinnedPositionBuffer } },
      ],
    }),
  ],
});
this.shadowMesh.frustumCulled = false; // skinned/storage-positioned casters
```

Receiver bind-group entries (append the three shadow bindings to the receiver's
existing group-0 entries):

```js
{ binding: N,   resource: { buffer: shadowUniformBuffer } },
{ binding: N+1, resource: shadowMapSampler },
{ binding: N+2, resource: shadowDepthView },
```

Two-pass render loop:

```js
this.renderer.render({ scene: this.shadowMesh, camera: this.shadowCamera, target: this.shadowBuffer });
this.renderer.render({ scene: this.scene, camera: this.camera });
```

If the caster moves independently of the receiver, copy the receiver's
`position`/`quaternion` onto `this.shadowMesh` each frame (see
`examples/shadowmapping/Shadowmapping.js`). For a static-rooted skinned character
the caster can stay at identity — the animation lives in the shared storage
buffer, not the transform.
