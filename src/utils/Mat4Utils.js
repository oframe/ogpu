import { vec3 } from 'wgpu-matrix';
import { mat4 } from 'wgpu-matrix';
import { quat } from 'wgpu-matrix';

/**
 * From glTF-Transform
 * https://github.com/donmccurdy/glTF-Transform/blob/main/packages/core/src/utils/math-utils.ts
 *
 * Compose TRS properties to a mat4.
 *
 * Equivalent to the Matrix4 compose() method in three.js, and intentionally not using the
 * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
 *
 * @param {mat4} dstMat Matrix element, to be modified and returned.
 * @param {quat4} srcRotation Rotation element of matrix.
 * @param {vec3} srcTranslation Translation element of matrix.
 * @param {vec3} srcScale Scale element of matrix.
 * @returns {mat4} dstMat, overwritten to mat4 equivalent of given TRS properties.
 */
export const compose = (dstMat, srcRotation, srcTranslation, srcScale) => {
    const te = dstMat;

    const x = srcRotation[0],
        y = srcRotation[1],
        z = srcRotation[2],
        w = srcRotation[3];
    const x2 = x + x,
        y2 = y + y,
        z2 = z + z;
    const xx = x * x2,
        xy = x * y2,
        xz = x * z2;
    const yy = y * y2,
        yz = y * z2,
        zz = z * z2;
    const wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    const sx = srcScale[0],
        sy = srcScale[1],
        sz = srcScale[2];

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = srcTranslation[0];
    te[13] = srcTranslation[1];
    te[14] = srcTranslation[2];
    te[15] = 1;

    return te;
};

/**
 * From glTF-Transform
 * https://github.com/donmccurdy/glTF-Transform/blob/main/packages/core/src/utils/math-utils.ts
 *
 * Decompose a mat4 to TRS properties.
 *
 * Equivalent to the Matrix4 decompose() method in three.js, and intentionally not using the
 * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
 *
 * @param {mat4} srcMat Matrix element, to be decomposed to TRS properties.
 * @param {quat4} dstRotation Rotation element, to be overwritten.
 * @param {vec3} dstTranslation Translation element, to be overwritten.
 * @param {vec3} dstScale Scale element, to be overwritten
 */
export function decompose(srcMat, dstRotation, dstTranslation, dstScale) {
    let sx = vec3.length([srcMat[0], srcMat[1], srcMat[2]]);
    const sy = vec3.length([srcMat[4], srcMat[5], srcMat[6]]);
    const sz = vec3.length([srcMat[8], srcMat[9], srcMat[10]]);

    // if determine is negative, we need to invert one scale
    const det = mat4.determinant(srcMat);
    if (det < 0) sx = -sx;

    dstTranslation[0] = srcMat[12];
    dstTranslation[1] = srcMat[13];
    dstTranslation[2] = srcMat[14];

    // scale the rotation part
    const _m1 = srcMat.slice();

    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;

    _m1[0] *= invSX;
    _m1[1] *= invSX;
    _m1[2] *= invSX;

    _m1[4] *= invSY;
    _m1[5] *= invSY;
    _m1[6] *= invSY;

    _m1[8] *= invSZ;
    _m1[9] *= invSZ;
    _m1[10] *= invSZ;

    // Extract the quaternion FROM the (scale-stripped) rotation matrix.
    quat.fromMat(_m1, dstRotation);

    dstScale[0] = sx;
    dstScale[1] = sy;
    dstScale[2] = sz;
}
