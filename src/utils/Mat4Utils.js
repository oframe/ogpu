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

/**
 * Householder reflection across the plane n·p + constant = 0.
 *
 * @param {vec3} normal Unit plane normal.
 * @param {number} constant Plane constant (`-dot(normal, pointOnPlane)`).
 * @param {mat4} dstMat Matrix to overwrite and return.
 * @returns {mat4} dstMat set to the reflection (det = -1, involutory: R·R = I).
 */
export const reflectionMatrix = (normal, constant, dstMat = new Float32Array(16)) => {
    const nx = normal[0];
    const ny = normal[1];
    const nz = normal[2];
    const d = constant;

    dstMat[0] = 1 - 2 * nx * nx;
    dstMat[1] = -2 * nx * ny;
    dstMat[2] = -2 * nx * nz;
    dstMat[3] = 0;

    dstMat[4] = -2 * nx * ny;
    dstMat[5] = 1 - 2 * ny * ny;
    dstMat[6] = -2 * ny * nz;
    dstMat[7] = 0;

    dstMat[8] = -2 * nx * nz;
    dstMat[9] = -2 * ny * nz;
    dstMat[10] = 1 - 2 * nz * nz;
    dstMat[11] = 0;

    dstMat[12] = -2 * nx * d;
    dstMat[13] = -2 * ny * d;
    dstMat[14] = -2 * nz * d;
    dstMat[15] = 1;

    return dstMat;
};

/**
 * Transform a plane (vec4: normal.xyz, constant) as a row vector: dst = plane · m.
 * To move a world-space plane into a camera's view space pass the camera's
 * worldMatrix (the matrix mapping view-space points back to world).
 *
 * @param {vec4} plane Source plane.
 * @param {mat4} m Column-major matrix mapping target-space points to source-space.
 * @param {vec4} dstPlane Plane to overwrite and return (not renormalized).
 * @returns {vec4} dstPlane.
 */
export const transformPlane = (plane, m, dstPlane = new Float32Array(4)) => {
    const x = plane[0];
    const y = plane[1];
    const z = plane[2];
    const w = plane[3];
    dstPlane[0] = x * m[0] + y * m[1] + z * m[2] + w * m[3];
    dstPlane[1] = x * m[4] + y * m[5] + z * m[6] + w * m[7];
    dstPlane[2] = x * m[8] + y * m[9] + z * m[10] + w * m[11];
    dstPlane[3] = x * m[12] + y * m[13] + z * m[14] + w * m[15];
    return dstPlane;
};

const _invProj = /* @__PURE__ */ new Float32Array(16);

/**
 * Oblique near-plane clipping (Lengyel), adjusted for WebGPU's [0, 1] clip z:
 * rewrites the projection's z row so the near plane IS `clipPlane`, scaled so
 * the far plane still touches the frustum corner opposite the plane (minimal
 * depth-precision loss). Planar-reflection workhorse — clips everything behind
 * the mirror without a hardware clip distance.
 *
 * @param {mat4} projMat Source projection matrix.
 * @param {vec4} clipPlane View-space plane (normal.xyz, constant); visible side
 *   is `dot(clipPlane, p) > 0`, so the camera must sit on the negative side.
 * @param {mat4} dstMat Matrix to overwrite and return (may alias projMat).
 * @returns {mat4} dstMat.
 */
export const obliqueProjection = (projMat, clipPlane, dstMat = new Float32Array(16)) => {
    if (dstMat !== projMat) mat4.copy(projMat, dstMat);
    mat4.invert(projMat, _invProj);

    // Clip-space plane x/y signs pick the far corner on the plane's positive side.
    const cx = clipPlane[0] * _invProj[0] + clipPlane[1] * _invProj[1] + clipPlane[2] * _invProj[2] + clipPlane[3] * _invProj[3];
    const cy = clipPlane[0] * _invProj[4] + clipPlane[1] * _invProj[5] + clipPlane[2] * _invProj[6] + clipPlane[3] * _invProj[7];
    const qx = cx >= 0 ? 1 : -1;
    const qy = cy >= 0 ? 1 : -1;

    // Far-plane corner in view space (homogeneous): Q = P⁻¹ · (±1, ±1, 1, 1).
    const Qx = _invProj[0] * qx + _invProj[4] * qy + _invProj[8] + _invProj[12];
    const Qy = _invProj[1] * qx + _invProj[5] * qy + _invProj[9] + _invProj[13];
    const Qz = _invProj[2] * qx + _invProj[6] * qy + _invProj[10] + _invProj[14];
    const Qw = _invProj[3] * qx + _invProj[7] * qy + _invProj[11] + _invProj[15];

    // z row = clipPlane / (clipPlane·Q): near plane lands on the clip plane
    // (z' = 0) while the far plane (z' = w, and row4·Q = 1) still contains Q.
    const s = 1 / (clipPlane[0] * Qx + clipPlane[1] * Qy + clipPlane[2] * Qz + clipPlane[3] * Qw);
    dstMat[2] = clipPlane[0] * s;
    dstMat[6] = clipPlane[1] * s;
    dstMat[10] = clipPlane[2] * s;
    dstMat[14] = clipPlane[3] * s;

    return dstMat;
};
