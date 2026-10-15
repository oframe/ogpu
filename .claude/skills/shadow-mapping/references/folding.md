# Shadow mapping — copy-paste blocks

All blocks lifted from the two working examples. Adapt names; keep the
conventions (entry points `vs`/`fs`, texture prefix `t*`, user resources in
group 0). Every mesh shader starts with
`// validate-prepend: <relative path>/src/core/engine.wgsl` and reads the engine's
`camera.*` / `object.*` (group 1) instead of declaring matrices.

## 1. Caster WGSL (vertex-only — no `fs`)

### Static geometry (vertex attributes)

```wgsl
// validate-prepend: ../../src/core/engine.wgsl

struct Vertex { @location(0) position : vec3f }

@vertex
fn vs(in : Vertex) -> @builtin(position) vec4f {
  return camera.projectionMatrix * object.modelViewMatrix * vec4f(in.position, 1.0);
}
```

`camera` is whatever camera the caster scene is rendered with — render the caster
with the LIGHT camera and `camera.projectionMatrix` / `object.modelViewMatrix`
become the light's matrices automatically.

### Skinned / compute-positioned geometry

Pull position from the same storage buffer the main vertex stage uses, indexed
by `@builtin(vertex_index)`:

```wgsl
// validate-prepend: ../../src/core/engine.wgsl

@group(0) @binding(1) var<storage, read> positionBuffer : array<f32>;

struct Vertex { @builtin(vertex_index) vertexIndex : u32 }

@vertex
fn vs(in : Vertex) -> @builtin(position) vec4f {
  let position = vec3f(
    positionBuffer[in.vertexIndex * 3],
    positionBuffer[in.vertexIndex * 3 + 1],
    positionBuffer[in.vertexIndex * 3 + 2]
  );
  return camera.projectionMatrix * camera.viewMatrix * object.modelMatrix * vec4f(position, 1.0);
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
// worldPos = object.modelMatrix * vec4f(in.position, 1.0)
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
import { Camera, Mesh, Shader, UniformBuffer, RenderTarget, Mat4 } from 'ogpu';

const SHADOW_SIZE = 2048;
const SHADOW_FORMAT = 'depth32float';

// depth-only target
this.shadowBuffer = new RenderTarget(this.gpu, {
    width: SHADOW_SIZE,
    height: SHADOW_SIZE,
    depth: 1,
    color: false,
    depthTexture: true,
    depthFormat: SHADOW_FORMAT,
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
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    compare: 'less',
});

// two Shaders: a vertex-only caster, and the receiver (override baked in)
const casterShader = new Shader(this.gpu, { label: 'shadow-caster-shader', code: casterCode });
const receiverShader = new Shader(this.gpu, {
    label: 'receiver-shader',
    code: receiverCode,
    constants: { shadowDepthTextureSize: SHADOW_SIZE },
});

// Shadow uniform buffer — built off ANY receiver's reflected struct; `set` uploads
const shadowUniforms = new UniformBuffer(
    this.gpu,
    receiverShader.defs.uniforms.shadowUniforms,
    { projectionViewMatrix: shadowVP, lightDirection: lightDir.map((v) => v / lightLen) },
    { label: 'shadow-uniforms' }
);
const shadowDepthView = this.shadowBuffer.depthTexture.createView();

// caster mesh: no gpu, no pipeline — the slope bias rides on `state`, and the
// depth-only format comes from the pass (this.shadowBuffer)
this.shadowMesh = new Mesh({
    label: 'shadow-caster',
    geometry,
    shader: casterShader,
    state: { depthBias: 1, depthBiasSlopeScale: 1.75, depthBiasClamp: 0.0 },
    // skinned only: bind the Skin's storage buffer by WGSL name
    // bindGroups: [casterShader.bindGroup(0, { positionBuffer: skin.skinnedPositionBuffer })],
});
this.shadowMesh.frustumCulled = false; // skinned/storage-positioned casters
```

Receiver mesh — add the three shadow resources to its group-0 `bindGroup` call, by
WGSL name:

```js
const receiver = new Mesh({
    label: 'receiver',
    geometry: receiverGeometry,
    shader: receiverShader,
    state: { cullMode: 'back' },
    bindGroups: [
        receiverShader.bindGroup(0, {
            shadowUniforms,
            shadowSampler: shadowMapSampler,
            shadowMap: shadowDepthView,
            // …the receiver's own bindings
        }),
    ],
});
```

Two-pass render loop:

```js
this.renderer.render({ scene: this.shadowMesh, camera: this.shadowCamera, target: this.shadowBuffer });
this.renderer.render({ scene: this.scene, camera: this.camera });
```

Optionally warm both pipelines up front (they are derived per pass, so each target
needs its own): `renderer.compile({ scene: this.shadowMesh, target: this.shadowBuffer })`
and `renderer.compile({ scene: this.scene })`.

If the caster moves independently of the receiver, copy the receiver's
`position`/`quaternion` onto `this.shadowMesh` each frame (see
`examples/shadowmapping/Shadowmapping.js`). For a static-rooted skinned character
the caster can stay at identity — the animation lives in the shared storage
buffer, not the transform.
