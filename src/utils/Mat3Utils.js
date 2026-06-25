import { mat3, mat4, vec3 } from 'wgpu-matrix';

/**
 * Based on https://www.shadertoy.com/view/3s33zj
 * @param {mat4} m
 * @param {mat4} dstMat
 */
export const adjugate = (m, dstMat) => {
    const x = mat4.getAxis(m, 0);
    const y = mat4.getAxis(m, 1);
    const z = mat4.getAxis(m, 2);

    const yxz = vec3.cross([y[0], y[1], y[2]], [z[0], z[1], z[2]]);
    const zxx = vec3.cross([z[0], z[1], z[2]], [x[0], x[1], x[2]]);
    const xxy = vec3.cross([x[0], x[1], x[2]], [y[0], y[1], y[2]]);

    return mat3.set(yxz[0], yxz[1], yxz[2], zxx[0], zxx[1], zxx[2], xxy[0], xxy[1], xxy[2], dstMat);
};
