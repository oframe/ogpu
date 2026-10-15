// quat: wgpu-matrix 3.4.2's quat (Float32Array). Out param last and optional
// (allocated when omitted), returned; out may alias any input. Only the names
// the engine uses are re-exported; rotationTo is local (below).
import { quat, vec3 } from 'wgpu-matrix';

export const { conjugate, dot, fromAxisAngle, fromEuler, fromMat, identity, inverse, length, mul, normalize, rotateX, rotateY, rotateZ, slerp } = quat;

const _axis = new Float32Array(3);

// Shortest arc taking unit vector a to unit vector b. Antiparallel input
// (dot < -0.999999) has no unique arc: it returns a 180° turn (axis, 0) about
// an axis perpendicular to a — x̂ × a, or ŷ × a when a is near the x axis
// (wgpu-matrix 3.4.2 returns a degenerate zero-axis quat there).
export function rotationTo(a, b, out) {
    out ??= new Float32Array(4);
    const d = vec3.dot(a, b);
    if (d < -0.999999) {
        // x̂ × a = (0, -az, ay); ŷ × a = (az, 0, -ax)
        let x = 0;
        let y = -a[2];
        let z = a[1];
        if (y * y + z * z < 0.000001) {
            x = a[2];
            y = 0;
            z = -a[0];
        }
        const k = 1 / Math.sqrt(x * x + y * y + z * z);
        out[0] = x * k;
        out[1] = y * k;
        out[2] = z * k;
        out[3] = 0;
        return out;
    }
    if (d > 0.999999) return identity(out);
    vec3.cross(a, b, _axis);
    out[0] = _axis[0];
    out[1] = _axis[1];
    out[2] = _axis[2];
    out[3] = 1 + d;
    return normalize(out, out);
}
