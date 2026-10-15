// vec4: wgpu-matrix 3.4.2's vec4 (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported.
import { vec4 } from 'wgpu-matrix';

export const { add, addScaled, distance, distanceSq, dot, length, lengthSq, lerp, max, min, multiply, negate, normalize, scale, subtract, transformMat4 } = vec4;
