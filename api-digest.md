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

### src/core/KTXTexture.js
- **class KTXTexture** extends Texture
  - constructor(gpu, { src, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label = '…)

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
- re-export { KTXTexture } from './KTXTexture.js'
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
  - getGeometryData(meshOrIndex = 0)
  - getGeometry(meshOrIndex = 0)
  - getAnimation({ animation = 0, skin = 0, fps = 30 } = {})

### src/modules/GUI.js
- **class GUI**
  - constructor({ title = 'OGPU', expanded = true, container, pane } = {})
  - add(obj, key, opts = {})
  - monitor(obj, key, opts = {})
  - button(title, onClick)
  - folder(title, { expanded = true } = {})
  - uniform(target, key, opts = {})
  - dispose()

### src/modules/Orbit.js
- fn `Orbit(object, { element = document, enabled = true, target = new Vec3(0, 0, 0), ease = 0.25, in…)`

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

### src/utils/JSONLoader.js
- fn `loadJSON(url, opts)`
- fn `loadJSONAll(urls, opts)`

### src/utils/Mat3Utils.js
- fn `adjugate(m, dstMat)`

### src/utils/Mat4Utils.js
- fn `compose(dstMat, srcRotation, srcTranslation, srcScale)`
- fn `decompose(srcMat, dstRotation, dstTranslation, dstScale)`

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

### examples/computefrustumculling/ComputeFrustumCulling.js
- **class ComputeFrustumCulling**
  - constructor()
  - init()
  - cameraPath(vec, time, y)

### examples/cubemap/CubeMap.js
- **class CubeMapExample**
  - constructor()
  - init()

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

### examples/instancing/Instancing.js
- **class Instancing**
  - constructor()
  - init()

### examples/instancingpicking/InstancingPicking.js
- **class InstancingPicking**
  - constructor()
  - init()

### examples/ktx/KTX.js
- **class KTX**
  - constructor()
  - init()
  - addInfo(text)

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

### examples/primitives/Primitives.js
- **class Primitives**
  - constructor()
  - init()

### examples/raycasting/Raycasting.js
- **class Raycasting**
  - constructor()
  - init()

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

### examples/sorttransparency/SortTransparency.js
- **class SortTransparency**
  - constructor()
  - init()

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
- re-export { createStorageBuffer, createUniformBuffer, createBuffer } from './utils/BufferUtils.js'
- re-export { loadJSON, loadJSONAll } from './utils/JSONLoader.js'
- re-export { loadIBLCubeMap, loadSphericalHarmonics } from './utils/IBLUtils/IBLUtils.js'
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
