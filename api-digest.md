# API digest

Terse public-surface index of `src/` for navigation: read a file’s API without opening it. Exported classes (with public method signatures), functions, consts, and barrel re-exports. Private (`_`-prefixed) methods and accessors omitted. Auto-generated — regenerate with `node scripts/build-api-digest.mjs`. Pairs with AGENTS.md (rationale) and module-graph.json (import edges).

## core

### src/core/Camera.js
- **class Camera** extends Transform
  - constructor({ near = 0.1, far = 100, fov = 45, aspect = 1, left, right, bottom, top, zoom = 1 } = {})
  - perspective({ near = this.near, far = this.far, fov = this.fov, aspect = this.aspect } = {})
  - orthographic({ near = this.near, far = this.far, left = this.left || -1, right = this.right || 1, bott…)
  - updateMatrixWorld()
  - updateProjectionMatrix()
  - lookAt(target)
  - project(v)
  - unproject(v)
  - updateFrustum()
  - frustumIntersectsMesh(node, worldMatrix = node.worldMatrix)
  - frustumIntersectsSphere(center, radius)
  - getFrustumSize(z)

### src/core/ComputeShader.js
- **class ComputeShader**
  - constructor(gpu, { label = '', code = ``, layout = 'auto', constants = {}, size = 0 } = {})
  - build(code)
  - reload(code)
  - isValidKernel(key)
  - findKernel(key)
  - bindGroupLayout(kernelOrKey, groupIndex = 0)
  - dispatch(encoder, { pass = null, kernel, bindGroup, bindGroupIndex = 0, dispatchCount, workgroupBu…)

### src/core/Geometry.js
- **class Geometry**
  - constructor(gpu, { data, instancedData, interleave = false, drawBuffer = null } = {})
  - computeBoundingBox(attr = this._positionAttr())
  - computeBoundingSphere(attr = this._positionAttr())
  - destroy()

### src/core/Mesh.js
- **class Mesh** extends Transform
  - constructor(gpu, { label = 'basic mesh', pipeline, geometry, bindGroups, manualRender = false, render…)
  - onBeforeRender(f)
  - onAfterRender(f)
  - draw({ camera = null, pass, time = 0 } = {})

### src/core/RenderPipeline.js
- **class RenderPipeline**
  - constructor(gpu, { label = 'rendering', code = ``, vertexBuffers = [], targets, depthTest = true, dep…)
  - build(code)
  - bindGroupLayout(groupIndex = 0)
  - reload(code)
  - destroy()

### src/core/RenderTarget.js
- **class RenderTarget**
  - constructor(gpu, { width = 1280, height = 720, depth = 1, format = 'bgra8unorm', dimension = '2d', co…)
  - createTextures()
  - createDepthTexture()
  - createView(i = 0)
  - getTargets()
  - destroy()
  - onResize({ width, height, depth } = {})

### src/core/Renderer.js
- **class Renderer**
  - constructor({ canvas = null, dpr = null, transparent = false, depth = true, stencil = true } = {})
  - initDevice()
  - init(device)
  - createDepthTexture()
  - addHandlers()
  - addResizeHandler(cb)
  - add(f)
  - remove(f)
  - addDeviceLostHandler(cb)
  - addDeviceRestoredHandler(cb)
  - addBootProgressHandler(cb)
  - addBootCompleteHandler(cb)
  - forceDeviceLoss()
  - setClearColor({ r = 0, g = 0, b = 0, a = this.transparent ? 0 : 1 } = {})
  - trackCompile(promise)
  - updateClock(time = 0)
  - sortOpaque(a, b)
  - sortTransparent(a, b)
  - sortUI(a, b)
  - getRenderQueue({ scene, camera, sort = true, frustumCull = true } = {})
  - render({ scene, camera, target = null, loadOp = 'clear', storeOp = 'store', depthLoadOp = 'clear…)

### src/core/ShaderReload.js
- fn `registerShader(instance)`

### src/core/Texture.js
- **class Texture**
  - constructor(gpu, { width = 2, height = 2, depth = 1, data = null, format = 'rgba8unorm', dimension = …)
  - update({ width = 2, height = 2, depth = 1, data, format = 'rgba8unorm', dimension = '2d', usage …)
  - createView()
  - destroy()

### src/core/Transform.js
- **class Transform**
  - constructor()
  - setParent(parent, notifyParent = true)
  - addChild(child, notifyChild = true)
  - removeChild(child, notifyChild = true)
  - updateMatrixWorld(force)
  - updateMatrix()
  - traverse(callback)
  - lookAt(target, invert)
  - decompose()
  - setRotation(quaternion)
  - rotateX(angle)
  - rotateY(angle)
  - rotateZ(angle)
  - getEuler(out = new Euler())

### src/core/index.js
- re-export { Renderer } from './Renderer.js'
- re-export { Transform } from './Transform.js'
- re-export { Camera } from './Camera.js'
- re-export { Mesh } from './Mesh.js'
- re-export { Geometry } from './Geometry.js'
- re-export { Box, Sphere, Plane, Torus, Cylinder, Disc, Cone, Quad, ThreeDF, FullscreenTriangle } from './primitives/index.js'
- re-export { RenderPipeline } from './RenderPipeline.js'
- re-export { ComputeShader } from './ComputeShader.js'
- re-export { Texture } from './Texture.js'
- re-export { RenderTarget } from './RenderTarget.js'
- re-export { Skin } from './skin/Skin.js'

### src/core/primitives/Box.js
- **class Box** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/Cone.js
- **class Cone** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/Cylinder.js
- **class Cylinder** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/Disc.js
- **class Disc** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/FullscreenTriangle.js
- **class FullscreenTriangle** extends Geometry
  - constructor(gpu, { instancedData, interleave } = {})

### src/core/primitives/Plane.js
- **class Plane** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/Quad.js
- **class Quad** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/Sphere.js
- **class Sphere** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/ThreeDF.js
- **class ThreeDF** extends Geometry
  - constructor(gpu, { instancedData, interleave } = {})

### src/core/primitives/Torus.js
- **class Torus** extends Geometry
  - constructor(gpu, { instancedData, interleave, ...opts } = {})

### src/core/primitives/index.js
- re-export { Box } from './Box.js'
- re-export { Sphere } from './Sphere.js'
- re-export { Plane } from './Plane.js'
- re-export { Torus } from './Torus.js'
- re-export { Cylinder } from './Cylinder.js'
- re-export { Disc } from './Disc.js'
- re-export { Cone } from './Cone.js'
- re-export { Quad } from './Quad.js'
- re-export { ThreeDF } from './ThreeDF.js'
- re-export { FullscreenTriangle } from './FullscreenTriangle.js'

### src/core/skin/Skin.js
- **class Skin**
  - constructor(gpu, { label = 'skin', data } = {})
  - initBones()
  - createGeometryBuffer(name, size, data)
  - initSkinning()
  - addAnimation(animation)
  - getAnimation(label)
  - applyAnimations()
  - updateBones()
  - update(dt = 0)

## modules

### src/modules/Animation.js
- **class Animation**
  - constructor({ transforms = [], label = 'animation', data = [], loop = true } = {})
  - fps(value)
  - update(totalWeight = 1, isSet = false)

### src/modules/CubeMap.js
- **class CubeMap**
  - constructor(gpu, { src = [], mips = false, flipY = false, usage = GPUTextureUsage.TEXTURE_BINDING | G…)
  - destroy()

### src/modules/GLTFLoader.js
- **class GLTFLoader**
  - constructor(gpu, { code, iblEntries = [], // override constants baked into the shader (e.g. roughness…)
  - load(url)
  - getSkinData(meshOrIndex = 0)
  - getSkinnedMesh({ code, ibl, mesh = 0, animation = 0, fps = 30, label = 'skinned', material = {} } = {})
  - getGeometryData(meshOrIndex = 0)
  - getGeometry(meshOrIndex = 0)
  - getAnimation({ animation = 0, skin = 0, fps = 30 } = {})
  - getMaterialTexture(materialIndex = 0, map = 'baseColor')

### src/modules/GUI.js
- **class GUI**
  - constructor({ title = 'OGPU', expanded = false, container, pane } = {})
  - add(obj, key, opts = {})
  - monitor(obj, key, opts = {})
  - button(title, onClick)
  - folder(title, { expanded = true } = {})
  - uniform(target, key, opts = {})
  - dispose()

### src/modules/KTXTexture.js
- **class KTXTexture** extends Texture
  - constructor(gpu, { src, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label = '…)

### src/modules/Orbit.js
- fn `Orbit(object, { element = document, enabled = true, target = new Vec3(0, 0, 0), ease = 0.25, in…)`

### src/modules/PerformanceProfile.js
- **class PerformanceProfile**
  - setQuality(tier)
  - onQualityChange(cb)
  - addGUI(gui)
  - startWatchdog(renderer, { windowSize = 90, thresholdMs = 22, cooldownMs = 4000, onSuggestDowngrade } = …)

### src/modules/Raycast.js
- **class Raycast**
  - constructor()
  - castMouse(camera, mouse = [0, 0])
  - intersectBounds(meshes, { maxDistance, output = [] } = {})
  - intersectMeshes(meshes, { cullFace = true, maxDistance, includeUV = true, includeNormal = true, output = …)
  - intersectPlane(plane, origin = this.origin, direction = this.direction, out = null)
  - intersectSphere(sphere, origin = this.origin, direction = this.direction)
  - intersectBox(box, origin = this.origin, direction = this.direction)
  - intersectTriangle(a, b, c, backfaceCulling = true, origin = this.origin, direction = this.direction, normal…)
  - getBarycoord(point, a, b, c, target = tempVec3h)

### src/modules/VideoTexture.js
- **class VideoTexture**
  - constructor(gpu, { video, format = 'rgba8unorm', label = '', autoStart = true, flipY = false } = {})
  - start()
  - stop()
  - createView()
  - destroy()

### src/modules/interaction/InteractionManager.js
- **class InteractionManager**
  - constructor({ renderer, camera, targets = [], clickSlop = 6, dragPlaneNormal = 'up', cursor = true, p…)
  - on(mesh, type, cb)
  - off(mesh)
  - update()
  - dispose()

### src/modules/interaction/Pointer.js
- **class Pointer**
  - constructor()

### src/modules/interaction/Spring.js
- **class Spring**
  - constructor({ stiffness = 170, damping = 26, mass = 1, value = 0, target, precision = 1e-3, preset } …)
  - setTarget(v)
  - jump(v)
  - kick(v)
  - onRest(cb)
  - update(dt)
- const `SPRING_PRESETS`

### src/modules/interaction/easing.js
- fn `ease(name)`
- fn `cubicBezier(x1, y1, x2, y2)`
- const `EASE_NAMES`

### src/modules/particles/ParticleSystem.js
- **class ParticleSystem** extends Mesh
  - constructor(gpu, { capacity = 100_000, preset = null, emitter, forces, boids, appearance, wrap, mode,…)
  - update(encoder = null, { dt = 1 / 60 } = {})
  - reset()
  - setPreset(name)
  - setBlending(mode)
  - setQuality(tier)
  - addGUI(gui)
  - dispose()

### src/modules/particles/presets.js
- const `PARTICLE_PRESETS`

### src/modules/post/FullscreenPass.js
- **class FullscreenPass**
  - constructor(gpu, { label = 'fullscreen-pass', code = ``, targets, blending = {}, transparent = false,…)
  - setBindings(bindings = {}, key = 'default')
  - draw(encoder, { view, colorAttachments = null, loadOp = 'clear', clearValue = { r: 0, g: 0, b:…)
  - dispose()

### src/modules/post/PostProcessing.js
- **class PostProcessing**
  - constructor(gpu, { effects = [], format = 'rgba16float', label = 'post' } = {})
  - addEffect(effect)
  - setQuality(quality)
  - setSize(width, height)
  - render({ scene, camera } = {})
  - dispose()

### src/modules/post/effects/AOBase.js
- **class AOBase**
  - constructor(gpu, { format = 'rgba16float', label = 'ao', code } = {})
  - resize()
  - updateUniforms()
  - render(encoder, ctx)
  - dispose()

### src/modules/post/effects/BloomEffect.js
- **class BloomEffect**
  - constructor(gpu, { format = 'rgba16float', mode = 'unreal', intensity = 0.7, threshold = 1.0, knee = …)
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, sampler, size })
  - addGUI(gui)
  - dispose()
- const `BLOOM_MODES`, `BLOOM_MASKS`

### src/modules/post/effects/BlurEffect.js
- **class BlurEffect**
  - constructor(gpu, { format = 'rgba16float', mode = 'gaussian', radius = 8, amount = 1 } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, sampler, size })
  - addGUI(gui)
  - dispose()
- const `BLUR_MODES`

### src/modules/post/effects/DoFEffect.js
- **class DoFEffect**
  - constructor(gpu, { format = 'rgba16float', focusDistance = 10, focusRange = 6, bokehRadius = 8 } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, depthView, sampler, size, camera })
  - addGUI(gui)
  - dispose()

### src/modules/post/effects/FXAAEffect.js
- **class FXAAEffect**
  - constructor(gpu, { format = 'rgba16float' } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, sampler, size })
  - addGUI(gui)
  - dispose()

### src/modules/post/effects/FinalPassEffect.js
- **class FinalPassEffect**
  - constructor(gpu, { format = 'rgba16float', toneMapping = 'aces' } = {})
  - setQuality()
  - resize()
  - render(encoder, { sourceView, destView, sampler, size })
  - addGUI(gui)
  - dispose()
- const `TONEMAP`

### src/modules/post/effects/GTAOEffect.js
- **class GTAOEffect** extends AOBase
  - constructor(gpu, { format = 'rgba16float', radius = 1.0, power = 1.2, bias = 0.08 } = {})
  - setQuality(tier)
  - updateUniforms({ camera, frameIndex }, { aoWidth, aoHeight })
  - addGUI(gui)

### src/modules/post/effects/SMAAEffect.js
- **class SMAAEffect**
  - constructor(gpu, { format = 'rgba16float', assetsPath = './assets/smaa' } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, sampler, size })
  - addGUI(gui)
  - dispose()

### src/modules/post/effects/SSAOEffect.js
- **class SSAOEffect** extends AOBase
  - constructor(gpu, { format = 'rgba16float', radius = 0.8, bias = 0.02, power = 1.2 } = {})
  - setQuality(tier)
  - updateUniforms({ camera, frameIndex }, { aoWidth, aoHeight })
  - addGUI(gui)

### src/modules/post/effects/SSREffect.js
- **class SSREffect**
  - constructor(gpu, { format = 'rgba16float', maxDistance = 18, thickness = 0.4, intensity = 0.8 } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, depthView, normalView, sampler, size, camera, frameIndex…)
  - addGUI(gui)
  - dispose()

### src/modules/post/effects/TAAEffect.js
- **class TAAEffect**
  - constructor(gpu, { format = 'rgba16float', blend = 0.9 } = {})
  - setQuality(tier)
  - resize()
  - render(encoder, { sourceView, destView, destTarget, depthView, sampler, size, camera, composer })
  - addGUI(gui)
  - dispose()

### src/modules/rain/RainSystem.js
- **class RippleField**
  - constructor(gpu, { resolution = 512, worldSize = 20, maxRipples = 256, label = 'ripple-field' } = {})
  - update(encoder, { dt = 1 / 60 } = {})
  - dispose()
- **class RainSystem** extends Transform
  - constructor(gpu, { preset = 'light', capacity = 60_000, area = 14, height = 10, ripple = {}, label = …)
  - update(encoder = null, { dt = 1 / 60, camera = null } = {})
  - setPreset(name)
  - setQuality(tier)
  - addGUI(gui)
  - dispose()
- const `RAIN_PRESETS`

### src/modules/raymarch/Raymarcher.js
- **class Raymarcher** extends Mesh
  - constructor(gpu, { post = null, ibl = null, preset = 'metaballs', maxPrimitives = 32, maxSteps = 96, …)
  - setPrimitive(i, { kind = 'sphere', position = [0, 0, 0], rotation = null, scale = 1, params = [1, 0, 0…)
  - clearPrimitives()
  - setMaterial(id, { color = [1, 1, 1], roughness = 0.5, metallic = 0, reflectivity = 0 } = {})
  - setPreset(name)
  - setQuality(tier)
  - setMaxSteps(steps)
  - addGUI(gui)
- const `PRIMITIVE_KINDS`

### src/modules/raymarch/presets.js
- const `PRESETS`

### src/modules/reflections/PlanarReflector.js
- **class PlanarReflector**
  - constructor(gpu, { resolutionScale = 0.5, matchPost = false, format = null, depthFormat = null, mipLe…)
  - setPlane(normal, point = [0, 0, 0])
  - addSurface(mesh)
  - addRebuildHandler(cb)
  - bindGroup(pipeline, uniformBuffer)
  - setResolutionScale(scale)
  - setSize(width, height)
  - reflectCamera(camera, plane = this.plane)
  - render({ scene, camera, renderer = this.gpu.renderer, hide = [] } = {})
  - dispose()

### src/modules/reflections/ReflectionProbe.js
- **class ReflectionProbe**
  - constructor(gpu, { size = 128, format = null, depthFormat = 'depth24plus', near = 0.05, far = 100, po…)
  - invalidate()
  - tick({ time = 0, ...rest } = {})
  - update({ scene, renderer = this.gpu.renderer, hide = [] } = {})
  - destroy()

### src/modules/sky/Sky.js
- **class Sky**
  - constructor(gpu, { post = null, ibl = {}, preset = 'physical', timeOfDay = 10, timeScale = 0, latitud…)
  - setPreset(name)
  - update({ deltaTime = 0 } = {})
  - refreshEnvironment()
  - addGUI(gui)
  - dispose()

### src/modules/sky/presets.js
- const `SKY_PRESETS`

### src/modules/text/MSDFFont.js
- **class MSDFFont**
  - constructor(data, texture)
  - glyph(codePoint)
  - kerning(prevCode, code)
  - destroy()

### src/modules/text/Text.js
- **class Text** extends Mesh
  - constructor(gpu, { font, text = '', fontSize = 1, letterSpacing = 0, lineHeight = 1, maxWidth = 0, al…)

## utils

### src/utils/BufferUtils.js
- fn `createStorageBuffer(gpu, { label = 'storage buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBuffer…)`
- fn `createUniformBuffer(gpu, { label = 'uniform buffer', size = null, usage = GPUBufferUsage.COPY_DST } = {})`
- fn `createBuffer(gpu, { label = 'buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.CO…)`

### src/utils/EulerUtils.js
- fn `fromRotationMatrix(m, order = 'YXZ', out)`

### src/utils/IBLUtils/IBLUtils.js
- fn `loadIBLCubeMap(gpu, { url, faceSize = DEFAULT_FACE_SIZE, mipLevels = null, label = 'IBL cube' } = {})`
- fn `loadSphericalHarmonics(url)`
- fn `createBrdfLUT(gpu, { size = 512, label = 'brdflut' } = {})`
- fn `createDynamicIBL(gpu, { faceSize = 128, mipLevels = null, samples = 256, label = 'dynamic-ibl' } = {})`

### src/utils/JSONLoader.js
- fn `loadJSON(url, opts)`
- fn `loadJSONAll(urls, opts)`

### src/utils/Mat3Utils.js
- fn `adjugate(m, dstMat)`

### src/utils/Mat4Utils.js
- fn `compose(dstMat, srcRotation, srcTranslation, srcScale)`
- fn `decompose(srcMat, dstRotation, dstTranslation, dstScale)`
- fn `reflectionMatrix(normal, constant, dstMat = new Float32Array(16))`
- fn `transformPlane(plane, m, dstPlane = new Float32Array(4))`
- fn `obliqueProjection(projMat, clipPlane, dstMat = new Float32Array(16))`

### src/utils/TimingHelper.js
- **class TimingHelper**
  - constructor(device)
  - beginRenderPass(encoder, descriptor = {})
  - beginComputePass(encoder, descriptor = {})
  - getResult()

### src/utils/ktxutils.js
- fn `formatBlockInfo(format)`
- fn `parseKTXHeader(u8)`
- fn `vkFormatToWebGPU(fmt)`
- fn `glFormatToWebGPU(fmt)`

### src/utils/miscutils.js
- **class NonNegativeRollingAverage**
  - constructor(numSamples = 30)
  - addSample(v)

### src/utils/utils.js
- fn `getPromise()`

### src/utils/wgslOverrides.js
- fn `applyOverrideConstants(code, constants = {})`

## examples

### examples/Loader.js
- **class Loader**
  - constructor(renderer, { el = '#ogpu-loader' } = {})

### examples/computefrustumculling/ComputeFrustumCulling.js
- **class ComputeFrustumCulling**
  - constructor()
  - init()
  - cameraPath(vec, time, y)

### examples/cubemap/CubeMap.js
- **class CubeMapExample**
  - constructor()
  - init()

### examples/dynamicsky/DynamicSky.js
- **class DynamicSky**
  - constructor({ el = null } = {})
  - init(el)
  - initSpheres()
  - solidTexture(rgba, label)
  - initPane()

### examples/frustumculling/FrustumCulling.js
- **class FrustumCulling**
  - constructor()
  - init()
  - cameraPath(vec, time, y)

### examples/gltf/GLTF.js
- **class GLTF**
  - constructor(canvas)
  - init(canvas)
  - initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.js…)

### examples/hellowebgpu/BoxMesh.js
- **class BoxMesh** extends Transform
  - constructor(gpu)

### examples/hellowebgpu/HelloWebGPU.js
- **class HelloWebGPU**
  - constructor()
  - init()

### examples/hellowebgpu/uniformStruct.js
- fn `makeUniformStruct(gpu, def, values, label)`

### examples/highmeshcount/HighMeshCount.js
- **class HighMeshCount**
  - constructor()
  - init()
  - setMeshCount(count)

### examples/instancing/Instancing.js
- **class Instancing**
  - constructor()
  - init()

### examples/instancingpicking/InstancingPicking.js
- **class InstancingPicking**
  - constructor()
  - init()

### examples/interaction/Interaction.js
- **class Interaction**
  - constructor({ el = null } = {})
  - init(el)
  - addMesh(geometry, { label, color, position })
  - initScene()
  - initInteraction()
  - initPane()

### examples/ktx/KTX.js
- **class KTX**
  - constructor()
  - init()
  - addInfo(text)

### examples/mirrors/Mirrors.js
- **class Mirrors**
  - constructor({ el = null } = {})
  - init(el)
  - addContentMesh(geometry, { label, color, position = [0, 0, 0], scale = null } = {})
  - initContent()
  - initMirrors()
  - rebindMirror(mesh, reflector)
  - initProbe()
  - initPane()

### examples/msaa/MSAA.js
- **class MSAA**
  - constructor()
  - init()
  - buildTarget(sampleCount)
  - initDisplay()
  - displayBindGroup()
  - bindDisplay()

### examples/orbitcontrols/OrbitControls.js
- **class OrbitControls**
  - constructor()
  - init()
  - addCredit()

### examples/particles/Particles.js
- **class Particles**
  - constructor()
  - init()

### examples/particlesystem/ParticleSystemExample.js
- **class ParticleSystemExample**
  - constructor()
  - init()

### examples/pbrshader/PBRShader.js
- **class PBRShader**
  - constructor({ el = null } = {})
  - init(el)
  - initTestScene()
  - loadTexture(url)
  - swizzleRMO(url)
  - addCarPart(jsonUrl, maps, { transparent = false } = {})
  - addShadowFloor()
  - initProbes(ibl)
  - initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.js…)
  - solidTexture(rgba, label)
  - initPane()

### examples/performance/Performance.js
- **class Performance**
  - constructor({ el = null } = {})
  - init(el)

### examples/postprocessing/PostProcessingExample.js
- **class PostProcessingExample**
  - constructor({ el = null } = {})
  - init(el)
  - addMesh(geometry, { label, color, emissive = [0, 0, 0], emissiveIntensity = 0, position = [0, 0, …)
  - initScene()
  - initPane()

### examples/primitives/Primitives.js
- **class Primitives**
  - constructor()
  - init()

### examples/rain/Rain.js
- **class Rain**
  - constructor()
  - init()
  - initGround()
  - initMeshes()

### examples/raycasting/Raycasting.js
- **class Raycasting**
  - constructor()
  - init()

### examples/raymarching/Raymarching.js
- **class Raymarching**
  - constructor({ el = null } = {})
  - init(el)
  - addMesh(geometry, { label, color, position = [0, 0, 0] } = {})
  - initScene()
  - initPane()

### examples/rendertotexture/RenderToTexture.js
- **class RenderToTexture**
  - constructor({ el = null } = {})
  - init(el)
  - initDisplay()
  - initTestScene()

### examples/scenegraph/SceneGraph.js
- **class SceneGraph**
  - constructor()
  - init()

### examples/shadowmapping/Shadowmapping.js
- **class Shadowmapping**
  - constructor({ el = null } = {})
  - init(el)

### examples/skinning/Skinning.js
- **class Skinning**
  - constructor(canvas)
  - init(canvas)
  - addCredit(html)

### examples/skinninggltf/SkinningGLTF.js
- **class SkinningGLTF**
  - constructor(canvas)
  - init(canvas)
  - initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.js…)
  - solidTexture(rgba, label)
  - addCredit(html)

### examples/sorttransparency/SortTransparency.js
- **class SortTransparency**
  - constructor()
  - init()

### examples/text/TextExample.js
- **class TextExample**
  - constructor({ el = null } = {})
  - init(el)
  - initPane()

### examples/textures/Textures.js
- **class Textures**
  - constructor()
  - init()

### examples/triangle/Triangle.js
- **class Triangle**
  - constructor()
  - init()

## index.js

### src/index.js
- re-export * from './core/index.js'
- re-export * from './math/index.js'
- re-export { Orbit } from './modules/Orbit.js'
- re-export { Raycast } from './modules/Raycast.js'
- re-export { GUI } from './modules/GUI.js'
- re-export { Animation } from './modules/Animation.js'
- re-export { GLTFLoader } from './modules/GLTFLoader.js'
- re-export { CubeMap } from './modules/CubeMap.js'
- re-export { VideoTexture } from './modules/VideoTexture.js'
- re-export { KTXTexture } from './modules/KTXTexture.js'
- re-export { PostProcessing } from './modules/post/PostProcessing.js'
- re-export { FullscreenPass } from './modules/post/FullscreenPass.js'
- re-export { FinalPassEffect, TONEMAP } from './modules/post/effects/FinalPassEffect.js'
- re-export { BloomEffect, BLOOM_MODES, BLOOM_MASKS } from './modules/post/effects/BloomEffect.js'
- re-export { BlurEffect, BLUR_MODES } from './modules/post/effects/BlurEffect.js'
- re-export { FXAAEffect } from './modules/post/effects/FXAAEffect.js'
- re-export { SMAAEffect } from './modules/post/effects/SMAAEffect.js'
- re-export { GTAOEffect } from './modules/post/effects/GTAOEffect.js'
- re-export { SSAOEffect } from './modules/post/effects/SSAOEffect.js'
- re-export { DoFEffect } from './modules/post/effects/DoFEffect.js'
- re-export { SSREffect } from './modules/post/effects/SSREffect.js'
- re-export { TAAEffect } from './modules/post/effects/TAAEffect.js'
- re-export { PerformanceProfile } from './modules/PerformanceProfile.js'
- re-export { InteractionManager } from './modules/interaction/InteractionManager.js'
- re-export { Pointer } from './modules/interaction/Pointer.js'
- re-export { Spring, SPRING_PRESETS } from './modules/interaction/Spring.js'
- re-export { ease, cubicBezier, EASE_NAMES } from './modules/interaction/easing.js'
- re-export { MSDFFont } from './modules/text/MSDFFont.js'
- re-export { Text } from './modules/text/Text.js'
- re-export { createStorageBuffer, createUniformBuffer, createBuffer } from './utils/BufferUtils.js'
- re-export { loadJSON, loadJSONAll } from './utils/JSONLoader.js'
- re-export { loadIBLCubeMap, loadSphericalHarmonics, createBrdfLUT } from './utils/IBLUtils/IBLUtils.js'
- re-export { TimingHelper } from './utils/TimingHelper.js'
- re-export { applyOverrideConstants } from './utils/wgslOverrides.js'

## math

### src/math/Color.js
- **class Color** extends Float32Array
  - constructor(r, g, b)
  - setHex(hex)
  - copy(c)
  - clone()
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)

### src/math/Euler.js
- **class Euler** extends Float32Array
  - constructor(x = 0, y = 0, z = 0, order = 'YXZ')
  - copy(e)
  - clone()
  - setFromRotationMatrix(m, order = this.order)
  - setFromQuaternion(q, order = this.order)
  - reorder(order)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)

### src/math/Mat3.js
- **class Mat3** extends Float32Array
  - constructor()
  - copy(m)
  - clone()
  - identity()
  - multiply(m)
  - invert()
  - transpose()
  - fromMat4(m)
  - fromNormalMatrix(m)
  - fromQuat(q)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)

### src/math/Mat4.js
- **class Mat4** extends Float32Array
  - constructor()
  - copy(m)
  - clone()
  - identity()
  - multiply(m)
  - premultiply(m)
  - invert()
  - transpose()
  - fromQuat(q)
  - compose(position, quaternion, scale)
  - decompose(position, quaternion, scale)
  - scale(v)
  - translate(v)
  - rotateX(angle)
  - rotateY(angle)
  - rotateZ(angle)
  - perspective(fovy, aspect, near, far)
  - ortho(left, right, bottom, top, near, far)
  - lookAt(eye, target, up)
  - aim(eye, target, up)
  - determinant()
  - getTranslation(out)
  - getScale(out)
  - getRotation(out)
  - getAxis(axis, out)
  - getMaxScaleOnAxis()
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)
  - inverse()
  - fromQuaternion(q)

### src/math/Quat.js
- **class Quat** extends Float32Array
  - constructor(x = 0, y = 0, z = 0, w = 1)
  - copy(q)
  - clone()
  - identity()
  - setFromEuler(x, y, z, order = 'xyz')
  - setFromAxisAngle(axis, angle)
  - setFromRotationMatrix(m)
  - multiply(q)
  - premultiply(q)
  - rotateX(angle)
  - rotateY(angle)
  - rotateZ(angle)
  - slerp(q, t)
  - invert()
  - conjugate()
  - normalize()
  - dot(q)
  - len()
  - equals(q)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)
  - fromEuler(x, y, z, order = 'xyz')
  - fromAxisAngle(axis, angle)
  - inverse()

### src/math/Vec2.js
- **class Vec2** extends Float32Array
  - constructor(x = 0, y = 0)
  - copy(v)
  - clone()
  - add(v)
  - sub(v)
  - multiply(v)
  - scale(s)
  - multiplyScalar(s)
  - negate()
  - normalize()
  - lerp(v, t)
  - dot(v)
  - len()
  - lenSq()
  - distance(v)
  - equals(v)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)
  - squaredLen()

### src/math/Vec3.js
- **class Vec3** extends Float32Array
  - constructor(x = 0, y = 0, z = 0)
  - copy(v)
  - clone()
  - add(v)
  - sub(v)
  - multiply(v)
  - scale(s)
  - multiplyScalar(s)
  - addScaled(v, s)
  - negate()
  - normalize()
  - lerp(v, t)
  - smoothLerp(v, decay, dt)
  - divide(v)
  - angle(v)
  - cross(v)
  - min(v)
  - max(v)
  - applyMat4(m)
  - applyMat3(m)
  - applyQuat(q)
  - scaleRotateMat4(m)
  - transformDirection(m)
  - dot(v)
  - len()
  - lenSq()
  - distance(v)
  - distanceSq(v)
  - equals(v)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)
  - applyMatrix4(m)
  - applyMatrix3(m)
  - applyQuaternion(q)
  - scaleRotateMatrix4(m)
  - squaredLen()
  - squaredDistance(v)

### src/math/Vec4.js
- **class Vec4** extends Float32Array
  - constructor(x = 0, y = 0, z = 0, w = 0)
  - copy(v)
  - clone()
  - add(v)
  - sub(v)
  - multiply(v)
  - scale(s)
  - multiplyScalar(s)
  - addScaled(v, s)
  - negate()
  - normalize()
  - lerp(v, t)
  - min(v)
  - max(v)
  - applyMat4(m)
  - dot(v)
  - len()
  - lenSq()
  - distance(v)
  - distanceSq(v)
  - equals(v)
  - fromArray(a, o = 0)
  - toArray(a = [], o = 0)
  - applyMatrix4(m)
  - squaredLen()
  - squaredDistance(v)

### src/math/index.js
- re-export { Vec2 } from './Vec2'
- re-export { Vec3 } from './Vec3'
- re-export { Vec4 } from './Vec4'
- re-export { Quat } from './Quat'
- re-export { Mat3 } from './Mat3'
- re-export { Mat4 } from './Mat4'
- re-export { Euler } from './Euler'
- re-export { Color } from './Color'
