// vec3: wgpu-matrix 3.4.2's vec3 (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported.
import { vec3 } from 'wgpu-matrix';

export const {
    add,
    addScaled,
    angle,
    cross,
    distance,
    distanceSq,
    divide,
    dot,
    length,
    lengthSq,
    lerp,
    max,
    min,
    multiply,
    negate,
    normalize,
    scale,
    subtract,
    transformMat3,
    transformMat4,
    transformMat4Upper3x3,
    transformQuat,
} = vec3;
