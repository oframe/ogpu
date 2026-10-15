// mat3: wgpu-matrix 3.4.2's mat3 (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported.
import { mat3 } from 'wgpu-matrix';

export const { copy, fromMat4, identity, inverse, multiply, set, transpose } = mat3;
