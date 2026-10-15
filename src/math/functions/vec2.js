// vec2: wgpu-matrix 3.4.2's vec2 (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported.
import { vec2 } from 'wgpu-matrix';

export const { add, distance, dot, length, lengthSq, lerp, multiply, negate, normalize, scale, subtract } = vec2;
