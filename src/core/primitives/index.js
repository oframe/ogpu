// Primitive geometry classes — `Geometry` subclasses wrapping webgpu-utils'
// primitive generators with named-option ergonomics:
//
//   import { Box, Sphere } from '@core/primitives';
//   const geo = new Sphere(gpu, { radius: 0.8 });
//
// Each takes `(gpu, opts)` where `opts` is the shape options for that primitive
// plus the `Geometry` passthroughs `instancedData` and `interleave`.

export { Box } from './Box.js';
export { Sphere } from './Sphere.js';
export { Plane } from './Plane.js';
export { Torus } from './Torus.js';
export { Cylinder } from './Cylinder.js';
export { Disc } from './Disc.js';
export { Cone } from './Cone.js';
export { Quad } from './Quad.js';
export { ThreeDF } from './ThreeDF.js';
export { FullscreenTriangle } from './FullscreenTriangle.js';
