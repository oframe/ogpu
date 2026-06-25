// Port of OGL's Raycast (https://github.com/oframe/ogl) adapted to the
// engine's chainable math wrappers and webgpu-utils geometry layout.
//
// Usage:
//   const raycast = new Raycast();
//   raycast.castMouse(camera, [ndcX, ndcY]);       // NDC: x right, y up, [-1, 1]
//   const hits = raycast.intersectBounds(meshes);   // fast sphere/AABB test
//   const hits = raycast.intersectMeshes(meshes);   // exact triangle test
//   if (hits.length) console.log(hits[0].hit.point, hits[0].hit.uv);
//
// Hits are the mesh objects themselves, sorted near-to-far, each with a
// `mesh.hit` object: {localPoint, point, distance, localFaceNormal,
// faceNormal, uv, localNormal, normal} (the last four only from
// intersectMeshes). Set `geometry.raycast = 'sphere'` to force sphere
// bounds-testing instead of the AABB default.
//
// Triangle testing reads CPU-side position/uv/normal attribute data, so it
// only works for meshes whose geometry carries real 3-component positions —
// indirect/instanced/vertex-pulled meshes (splats, voxels, skinned) resolve
// at bounds level only (and only when explicit `geometry.bounds` exist).

import { Vec2, Vec3, Mat4 } from '@math';

const tempVec2a = /* @__PURE__ */ new Vec2();
const tempVec2b = /* @__PURE__ */ new Vec2();
const tempVec2c = /* @__PURE__ */ new Vec2();

const tempVec3a = /* @__PURE__ */ new Vec3();
const tempVec3b = /* @__PURE__ */ new Vec3();
const tempVec3c = /* @__PURE__ */ new Vec3();
const tempVec3d = /* @__PURE__ */ new Vec3();
const tempVec3e = /* @__PURE__ */ new Vec3();
const tempVec3f = /* @__PURE__ */ new Vec3();
const tempVec3g = /* @__PURE__ */ new Vec3();
const tempVec3h = /* @__PURE__ */ new Vec3();
const tempVec3i = /* @__PURE__ */ new Vec3();
const tempVec3j = /* @__PURE__ */ new Vec3();
const tempVec3k = /* @__PURE__ */ new Vec3();

const tempMat4 = /* @__PURE__ */ new Mat4();

// geometry.attributes entries are either bare (typed) arrays or
// {data, numComponents} descriptors — normalize access
function attrData(attr) {
    return attr?.data ?? attr;
}

function attrStride(attr, fallback) {
    return attr?.numComponents || fallback;
}

export class Raycast {
    constructor() {
        this.origin = new Vec3();
        this.direction = new Vec3();
    }

    // Set ray from mouse unprojection. mouse = NDC [-1, 1], y up.
    // Convert from pixels: x = (px / width) * 2 - 1, y = 1 - (py / height) * 2
    castMouse(camera, mouse = [0, 0]) {
        if (camera.type === 'orthographic') {
            // Orthographic ray origin is on the near plane, not the camera position
            const { left, right, bottom, top, zoom } = camera;
            const x = left / zoom + ((right - left) / zoom) * (mouse[0] * 0.5 + 0.5);
            const y = bottom / zoom + ((top - bottom) / zoom) * (mouse[1] * 0.5 + 0.5);
            this.origin.set(x, y, 0).applyMat4(camera.worldMatrix);

            // Direction is the camera's forward (-z) axis
            this.direction.set(-camera.worldMatrix[8], -camera.worldMatrix[9], -camera.worldMatrix[10]).normalize();
        } else {
            camera.worldMatrix.getTranslation(this.origin);
            this.direction.set(mouse[0], mouse[1], 0.5);
            camera.unproject(this.direction);
            this.direction.sub(this.origin).normalize();
        }
        return this;
    }

    intersectBounds(meshes, { maxDistance, output = [] } = {}) {
        if (!Array.isArray(meshes)) meshes = [meshes];

        const invWorldMat4 = tempMat4;
        const origin = tempVec3a;
        const direction = tempVec3b;

        const hits = output;
        hits.length = 0;

        meshes.forEach((mesh) => {
            if (!mesh.geometry) return;
            if (!mesh.geometry.bounds || mesh.geometry.bounds.radius === Infinity) {
                // No CPU-derivable bounds (indirect/instanced/vertex-pulled)
                // and none set explicitly — can't raycast this mesh
                if (!mesh.geometry.computeBoundingSphere) return;
                mesh.geometry.computeBoundingSphere();
            }
            const bounds = mesh.geometry.bounds;
            if (!bounds || bounds.radius === Infinity) return;

            invWorldMat4.copy(mesh.worldMatrix).invert();

            // maxDistance is given in world units — rescale into local space
            let localMaxDistance;
            if (maxDistance) {
                direction.copy(this.direction).scaleRotateMat4(invWorldMat4);
                localMaxDistance = maxDistance * direction.len();
            }

            // Object-space ray, to align with the local bounding volume
            origin.copy(this.origin).applyMat4(invWorldMat4);
            direction.copy(this.direction).transformDirection(invWorldMat4);

            // Break out early if bounds too far away from origin
            if (maxDistance) {
                if (origin.distance(bounds.center) - bounds.radius > localMaxDistance) return;
            }

            let localDistance = 0;

            // Check origin isn't inside bounds before testing intersection
            if (mesh.geometry.raycast === 'sphere') {
                if (origin.distance(bounds.center) > bounds.radius) {
                    localDistance = this.intersectSphere(bounds, origin, direction);
                    if (!localDistance) return;
                }
            } else {
                if (origin.x < bounds.min.x || origin.x > bounds.max.x || origin.y < bounds.min.y || origin.y > bounds.max.y || origin.z < bounds.min.z || origin.z > bounds.max.z) {
                    localDistance = this.intersectBox(bounds, origin, direction);
                    if (!localDistance) return;
                }
            }

            if (maxDistance && localDistance > localMaxDistance) return;

            // Reuse a hit object per mesh to avoid per-cast allocations
            if (!mesh.hit) mesh.hit = { localPoint: new Vec3(), point: new Vec3() };

            mesh.hit.localPoint.copy(direction).scale(localDistance).add(origin);
            mesh.hit.point.copy(mesh.hit.localPoint).applyMat4(mesh.worldMatrix);
            mesh.hit.distance = mesh.hit.point.distance(this.origin);

            hits.push(mesh);
        });

        hits.sort((a, b) => a.hit.distance - b.hit.distance);
        return hits;
    }

    intersectMeshes(meshes, { cullFace = true, maxDistance, includeUV = true, includeNormal = true, output = [] } = {}) {
        // Test bounds first before testing geometry
        const hits = this.intersectBounds(meshes, { maxDistance, output });
        if (!hits.length) return hits;

        const invWorldMat4 = tempMat4;
        const origin = tempVec3a;
        const direction = tempVec3b;
        const a = tempVec3c;
        const b = tempVec3d;
        const c = tempVec3e;
        const closestFaceNormal = tempVec3f;
        const faceNormal = tempVec3g;
        const barycoord = tempVec3h;
        const uvA = tempVec2a;
        const uvB = tempVec2b;
        const uvC = tempVec2c;

        for (let i = hits.length - 1; i >= 0; i--) {
            const mesh = hits[i];
            const geometry = mesh.geometry;
            const attributes = geometry.attributes || {};

            const position = attrData(attributes.position);
            const stride = attrStride(attributes.position, 3);

            // No CPU triangle data (or 2D screen-space positions) — keep the
            // bounds-level hit as-is
            if (!position || stride < 3) continue;

            const index = attrData(attributes.indices);
            const count = index ? index.length : position.length / stride;

            invWorldMat4.copy(mesh.worldMatrix).invert();

            let localMaxDistance;
            if (maxDistance) {
                direction.copy(this.direction).scaleRotateMat4(invWorldMat4);
                localMaxDistance = maxDistance * direction.len();
            }

            origin.copy(this.origin).applyMat4(invWorldMat4);
            direction.copy(this.direction).transformDirection(invWorldMat4);

            let localDistance = 0;
            let closestA, closestB, closestC;

            for (let j = 0; j < count; j += 3) {
                const ai = index ? index[j] : j;
                const bi = index ? index[j + 1] : j + 1;
                const ci = index ? index[j + 2] : j + 2;

                a.fromArray(position, ai * stride);
                b.fromArray(position, bi * stride);
                c.fromArray(position, ci * stride);

                const distance = this.intersectTriangle(a, b, c, cullFace, origin, direction, faceNormal);
                if (!distance) continue;

                // Too far away
                if (maxDistance && distance > localMaxDistance) continue;

                if (!localDistance || distance < localDistance) {
                    localDistance = distance;
                    closestA = ai;
                    closestB = bi;
                    closestC = ci;
                    closestFaceNormal.copy(faceNormal);
                }
            }

            if (!localDistance) {
                hits.splice(i, 1);
                continue;
            }

            // Refine hit values from the bounds test to the exact triangle
            mesh.hit.localPoint.copy(direction).scale(localDistance).add(origin);
            mesh.hit.point.copy(mesh.hit.localPoint).applyMat4(mesh.worldMatrix);
            mesh.hit.distance = mesh.hit.point.distance(this.origin);

            if (!mesh.hit.faceNormal) {
                mesh.hit.localFaceNormal = new Vec3();
                mesh.hit.faceNormal = new Vec3();
                mesh.hit.uv = new Vec2();
                mesh.hit.localNormal = new Vec3();
                mesh.hit.normal = new Vec3();
            }

            mesh.hit.localFaceNormal.copy(closestFaceNormal).normalize();
            mesh.hit.faceNormal.copy(mesh.hit.localFaceNormal).transformDirection(mesh.worldMatrix);

            // Optional data, opt out to optimise a bit if necessary
            if (includeUV || includeNormal) {
                // Barycoords interpolate vertex data at the hit point
                a.fromArray(position, closestA * stride);
                b.fromArray(position, closestB * stride);
                c.fromArray(position, closestC * stride);
                this.getBarycoord(mesh.hit.localPoint, a, b, c, barycoord);
            }

            const uv = attrData(attributes.uv);
            if (includeUV && uv) {
                const uvStride = attrStride(attributes.uv, 2);
                uvA.fromArray(uv, closestA * uvStride);
                uvB.fromArray(uv, closestB * uvStride);
                uvC.fromArray(uv, closestC * uvStride);
                mesh.hit.uv.set(uvA.x * barycoord.x + uvB.x * barycoord.y + uvC.x * barycoord.z, uvA.y * barycoord.x + uvB.y * barycoord.y + uvC.y * barycoord.z);
            }

            const normal = attrData(attributes.normal);
            if (includeNormal && normal) {
                const normalStride = attrStride(attributes.normal, 3);
                a.fromArray(normal, closestA * normalStride);
                b.fromArray(normal, closestB * normalStride);
                c.fromArray(normal, closestC * normalStride);
                mesh.hit.localNormal
                    .set(
                        a.x * barycoord.x + b.x * barycoord.y + c.x * barycoord.z,
                        a.y * barycoord.x + b.y * barycoord.y + c.y * barycoord.z,
                        a.z * barycoord.x + b.z * barycoord.y + c.z * barycoord.z
                    )
                    .normalize();

                mesh.hit.normal.copy(mesh.hit.localNormal).transformDirection(mesh.worldMatrix);
            }
        }

        hits.sort((a, b) => a.hit.distance - b.hit.distance);
        return hits;
    }

    // plane = {origin: Vec3, normal: Vec3}. Returns distance along the ray
    // (0 = miss/parallel/behind); writes the hit point into `out` if given.
    intersectPlane(plane, origin = this.origin, direction = this.direction, out = null) {
        const toPlane = tempVec3c.copy(plane.origin).sub(origin);
        const denom = direction.dot(plane.normal);
        if (denom === 0) return 0;
        const delta = toPlane.dot(plane.normal) / denom;
        if (delta <= 0) return 0;
        if (out) out.copy(direction).scale(delta).add(origin);
        return delta;
    }

    intersectSphere(sphere, origin = this.origin, direction = this.direction) {
        const ray = tempVec3c.copy(sphere.center).sub(origin);
        const tca = ray.dot(direction);
        const d2 = ray.dot(ray) - tca * tca;
        const radius2 = sphere.radius * sphere.radius;
        if (d2 > radius2) return 0;
        const thc = Math.sqrt(radius2 - d2);
        const t0 = tca - thc;
        const t1 = tca + thc;
        if (t0 < 0 && t1 < 0) return 0;
        if (t0 < 0) return t1;
        return t0;
    }

    // Ray / axis-aligned bounding box
    intersectBox(box, origin = this.origin, direction = this.direction) {
        let tmin, tmax, tYmin, tYmax, tZmin, tZmax;
        const invdirx = 1 / direction.x;
        const invdiry = 1 / direction.y;
        const invdirz = 1 / direction.z;
        const min = box.min;
        const max = box.max;
        tmin = ((invdirx >= 0 ? min.x : max.x) - origin.x) * invdirx;
        tmax = ((invdirx >= 0 ? max.x : min.x) - origin.x) * invdirx;
        tYmin = ((invdiry >= 0 ? min.y : max.y) - origin.y) * invdiry;
        tYmax = ((invdiry >= 0 ? max.y : min.y) - origin.y) * invdiry;
        if (tmin > tYmax || tYmin > tmax) return 0;
        if (tYmin > tmin) tmin = tYmin;
        if (tYmax < tmax) tmax = tYmax;
        tZmin = ((invdirz >= 0 ? min.z : max.z) - origin.z) * invdirz;
        tZmax = ((invdirz >= 0 ? max.z : min.z) - origin.z) * invdirz;
        if (tmin > tZmax || tZmin > tmax) return 0;
        if (tZmin > tmin) tmin = tZmin;
        if (tZmax < tmax) tmax = tZmax;
        if (tmax < 0) return 0;
        return tmin >= 0 ? tmin : tmax;
    }

    // Möller–Trumbore via geometrictools (same source as three.js Ray.js)
    intersectTriangle(a, b, c, backfaceCulling = true, origin = this.origin, direction = this.direction, normal = tempVec3g) {
        const edge1 = tempVec3h.copy(b).sub(a);
        const edge2 = tempVec3i.copy(c).sub(a);
        normal.copy(edge1).cross(edge2);
        let DdN = direction.dot(normal);
        if (!DdN) return 0;
        let sign;
        if (DdN > 0) {
            if (backfaceCulling) return 0;
            sign = 1;
        } else {
            sign = -1;
            DdN = -DdN;
        }
        const diff = tempVec3j.copy(origin).sub(a);
        const q = tempVec3k;
        const DdQxE2 = sign * direction.dot(q.copy(diff).cross(edge2));
        if (DdQxE2 < 0) return 0;
        const DdE1xQ = sign * direction.dot(q.copy(edge1).cross(diff));
        if (DdE1xQ < 0) return 0;
        if (DdQxE2 + DdE1xQ > DdN) return 0;
        const QdN = -sign * diff.dot(normal);
        if (QdN < 0) return 0;
        return QdN / DdN;
    }

    getBarycoord(point, a, b, c, target = tempVec3h) {
        // http://www.blackpawn.com/texts/pointinpoly/default.html
        const v0 = tempVec3i.copy(c).sub(a);
        const v1 = tempVec3j.copy(b).sub(a);
        const v2 = tempVec3k.copy(point).sub(a);
        const dot00 = v0.dot(v0);
        const dot01 = v0.dot(v1);
        const dot02 = v0.dot(v2);
        const dot11 = v1.dot(v1);
        const dot12 = v1.dot(v2);
        const denom = dot00 * dot11 - dot01 * dot01;
        if (denom === 0) return target.set(-2, -1, -1);
        const invDenom = 1 / denom;
        const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
        return target.set(1 - u - v, v, u);
    }
}
