// Vertex generators: webgpu-utils' `primitives`. `primitives` here is the subset
// the primitive classes use, so the public surface stays these eight.
import { primitives as wguPrimitives } from 'webgpu-utils';

export const { createCubeVertices, createCylinderVertices, createDiscVertices, createPlaneVertices, createSphereVertices, createTorusVertices, createTruncatedConeVertices, createXYQuadVertices } =
    wguPrimitives;

export const primitives = {
    createCubeVertices,
    createCylinderVertices,
    createDiscVertices,
    createPlaneVertices,
    createSphereVertices,
    createTorusVertices,
    createTruncatedConeVertices,
    createXYQuadVertices,
};
