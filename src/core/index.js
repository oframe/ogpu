// Core barrel — engine primitives behind the `@core` alias, so consumers can
// `import { Box, Mesh } from '@core'`. The OGPU root barrel (src/index.js)
// re-exports this, so this is the single source of truth for Core's surface.

export { Renderer } from './Renderer.js';
export { Transform } from './Transform.js';
export { Camera } from './Camera.js';
export { Mesh } from './Mesh.js';
export { Geometry } from './Geometry.js';
export { Box, Sphere, Plane, Torus, Cylinder, Disc, Cone, Quad, ThreeDF, FullscreenTriangle } from './primitives/index.js';
export { RenderPipeline } from './RenderPipeline.js';
export { ComputeShader } from './ComputeShader.js';
export { Texture } from './Texture.js';
export { RenderTarget } from './RenderTarget.js';
export { Skin } from './skin/Skin.js';
