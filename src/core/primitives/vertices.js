// Ported from webgpu-utils (https://github.com/greggman/webgpu-utils),
// Copyright (c) Gregg Tavares, MIT License.

const isTypedArray = (arr) => arr && typeof arr.length === 'number' && arr.buffer instanceof ArrayBuffer;

// Output is identical to the original generators, including the upstream
// push() quirk below.
class TypedArrayWrapper {
    typedArray;
    cursor = 0;
    constructor(arr) {
        this.typedArray = arr;
    }
    // quirk: an array/typed-array arg writes the whole arg list, not that arg
    push(...data) {
        for (const value of data) {
            if (Array.isArray(value) || isTypedArray(value)) {
                this.typedArray.set(data, this.cursor);
                this.cursor += data.length;
            } else {
                this.typedArray[this.cursor++] = value;
            }
        }
    }
}

function createAugmentedTypedArray(numComponents, numElements, Type) {
    return new TypedArrayWrapper(new Type(numComponents * numElements));
}

export function createXYQuadVertices({ size: inSize = 2, xOffset = 0, yOffset = 0 } = {}) {
    const size = inSize * 0.5;
    return {
        position: {
            numComponents: 2,
            data: [xOffset + -1 * size, yOffset + -1 * size, xOffset + 1 * size, yOffset + -1 * size, xOffset + -1 * size, yOffset + 1 * size, xOffset + 1 * size, yOffset + 1 * size],
        },
        normal: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        texcoord: [0, 0, 1, 0, 0, 1, 1, 1],
        indices: [0, 1, 2, 2, 1, 3],
    };
}
/**
 * Creates XZ plane vertices.
 *
 * The created plane has position, normal, and texcoord data
 *
 * @param params
 * @param params.width Width of the plane. Default = 1
 * @param params.depth Depth of the plane. Default = 1
 * @param params.subdivisionsWidth Number of steps across the plane. Default = 1
 * @param params.subdivisionsDepth Number of steps down the plane. Default = 1
 * @return The created plane vertices.
 */
export function createPlaneVertices({ width = 1, depth = 1, subdivisionsWidth = 1, subdivisionsDepth = 1 } = {}) {
    const numVertices = (subdivisionsWidth + 1) * (subdivisionsDepth + 1);
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    for (let z = 0; z <= subdivisionsDepth; z++) {
        for (let x = 0; x <= subdivisionsWidth; x++) {
            const u = x / subdivisionsWidth;
            const v = z / subdivisionsDepth;
            positions.push(width * u - width * 0.5, 0, depth * v - depth * 0.5);
            normals.push(0, 1, 0);
            texcoords.push(u, v);
        }
    }
    const numVertsAcross = subdivisionsWidth + 1;
    const indices = createAugmentedTypedArray(3, subdivisionsWidth * subdivisionsDepth * 2, Uint16Array);
    for (let z = 0; z < subdivisionsDepth; z++) {
        for (let x = 0; x < subdivisionsWidth; x++) {
            // Make triangle 1 of quad.
            indices.push((z + 0) * numVertsAcross + x, (z + 1) * numVertsAcross + x, (z + 0) * numVertsAcross + x + 1);
            // Make triangle 2 of quad.
            indices.push((z + 1) * numVertsAcross + x, (z + 1) * numVertsAcross + x + 1, (z + 0) * numVertsAcross + x + 1);
        }
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
/**
 * Creates sphere vertices.
 *
 * The created sphere has position, normal, and texcoord data
 *
 * @param params
 * @param params.radius radius of the sphere. Default = 1
 * @param params.subdivisionsAxis number of steps around the sphere. Default = 24
 * @param params.subdivisionsHeight number of vertically on the sphere. Default = 12
 * @param params.startLatitudeInRadians where to start the
 *     top of the sphere. Default = 0
 * @param params.endLatitudeInRadians Where to end the
 *     bottom of the sphere. Default = π
 * @param params.startLongitudeInRadians where to start
 *     wrapping the sphere. Default = 0
 * @param params.endLongitudeInRadians where to end
 *     wrapping the sphere. Default = 2π
 * @return The created sphere vertices.
 */
export function createSphereVertices({
    radius = 1,
    subdivisionsAxis = 24,
    subdivisionsHeight = 12,
    startLatitudeInRadians = 0,
    endLatitudeInRadians = Math.PI,
    startLongitudeInRadians = 0,
    endLongitudeInRadians = Math.PI * 2,
} = {}) {
    if (subdivisionsAxis <= 0 || subdivisionsHeight <= 0) {
        throw new Error('subdivisionAxis and subdivisionHeight must be > 0');
    }
    const latRange = endLatitudeInRadians - startLatitudeInRadians;
    const longRange = endLongitudeInRadians - startLongitudeInRadians;
    // We are going to generate our sphere by iterating through its
    // spherical coordinates and generating 2 triangles for each quad on a
    // ring of the sphere.
    const numVertices = (subdivisionsAxis + 1) * (subdivisionsHeight + 1);
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    // Generate the individual vertices in our vertex buffer.
    for (let y = 0; y <= subdivisionsHeight; y++) {
        for (let x = 0; x <= subdivisionsAxis; x++) {
            // Generate a vertex based on its spherical coordinates
            const u = x / subdivisionsAxis;
            const v = y / subdivisionsHeight;
            const theta = longRange * u + startLongitudeInRadians;
            const phi = latRange * v + startLatitudeInRadians;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            const ux = cosTheta * sinPhi;
            const uy = cosPhi;
            const uz = sinTheta * sinPhi;
            positions.push(radius * ux, radius * uy, radius * uz);
            normals.push(ux, uy, uz);
            texcoords.push(1 - u, v);
        }
    }
    const numVertsAround = subdivisionsAxis + 1;
    const indices = createAugmentedTypedArray(3, subdivisionsAxis * subdivisionsHeight * 2, Uint16Array);
    for (let x = 0; x < subdivisionsAxis; x++) {
        for (let y = 0; y < subdivisionsHeight; y++) {
            // Make triangle 1 of quad.
            indices.push((y + 0) * numVertsAround + x, (y + 0) * numVertsAround + x + 1, (y + 1) * numVertsAround + x);
            // Make triangle 2 of quad.
            indices.push((y + 1) * numVertsAround + x, (y + 0) * numVertsAround + x + 1, (y + 1) * numVertsAround + x + 1);
        }
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
/**
 * Array of the indices of corners of each face of a cube.
 */
const CUBE_FACE_INDICES = [
    [3, 7, 5, 1], // right
    [6, 2, 0, 4], // left
    [6, 7, 3, 2], // ??
    [0, 1, 5, 4], // ??
    [7, 6, 4, 5], // front
    [2, 3, 1, 0], // back
];
/**
 * Creates the vertices and indices for a cube.
 *
 * The cube is created around the origin. (-size / 2, size / 2).
 *
 * @param params
 * @param params.size width, height and depth of the cube. Default = 1
 * @return The created vertices.
 */
export function createCubeVertices({ size = 1 } = {}) {
    const k = size / 2;
    const cornerVertices = [
        [-k, -k, -k],
        [+k, -k, -k],
        [-k, +k, -k],
        [+k, +k, -k],
        [-k, -k, +k],
        [+k, -k, +k],
        [-k, +k, +k],
        [+k, +k, +k],
    ];
    const faceNormals = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
    ];
    const uvCoords = [
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
    ];
    const numVertices = 6 * 4;
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    const indices = createAugmentedTypedArray(3, 6 * 2, Uint16Array);
    for (let f = 0; f < 6; ++f) {
        const faceIndices = CUBE_FACE_INDICES[f];
        for (let v = 0; v < 4; ++v) {
            const position = cornerVertices[faceIndices[v]];
            const normal = faceNormals[f];
            const uv = uvCoords[v];
            // Each face needs all four vertices because the normals and texture
            // coordinates are not all the same.
            positions.push(...position);
            normals.push(...normal);
            texcoords.push(...uv);
        }
        // Two triangles make a square face.
        const offset = 4 * f;
        indices.push(offset + 0, offset + 1, offset + 2);
        indices.push(offset + 0, offset + 2, offset + 3);
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
/**
 * Creates vertices for a truncated cone, which is like a cylinder
 * except that it has different top and bottom radii. A truncated cone
 * can also be used to create cylinders and regular cones. The
 * truncated cone will be created centered about the origin, with the
 * y axis as its vertical axis. .
 *
 * @param params
 * @param params.bottomRadius Bottom radius of truncated cone. Default = 1
 * @param params.topRadius Top radius of truncated cone. Default = 0
 * @param params.height Height of truncated cone. Default = 1
 * @param params.radialSubdivisions The number of subdivisions around the
 *     truncated cone. Default = 24
 * @param params.verticalSubdivisions The number of subdivisions down the
 *     truncated cone. Default = 1
 * @param params.topCap Create top cap. Default = true.
 * @param params.bottomCap Create bottom cap. Default = true.
 * @return The created cone vertices.
 */
export function createTruncatedConeVertices({ bottomRadius = 1, topRadius = 0, height = 1, radialSubdivisions = 24, verticalSubdivisions = 1, topCap = true, bottomCap = true } = {}) {
    if (radialSubdivisions < 3) {
        throw new Error('radialSubdivisions must be 3 or greater');
    }
    if (verticalSubdivisions < 1) {
        throw new Error('verticalSubdivisions must be 1 or greater');
    }
    const extra = (topCap ? 2 : 0) + (bottomCap ? 2 : 0);
    const numVertices = (radialSubdivisions + 1) * (verticalSubdivisions + 1 + extra);
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    const indices = createAugmentedTypedArray(3, radialSubdivisions * (verticalSubdivisions + extra / 2) * 2, Uint16Array);
    const vertsAroundEdge = radialSubdivisions + 1;
    // The slant of the cone is constant across its surface
    const slant = Math.atan2(bottomRadius - topRadius, height);
    const cosSlant = Math.cos(slant);
    const sinSlant = Math.sin(slant);
    const start = topCap ? -2 : 0;
    const end = verticalSubdivisions + (bottomCap ? 2 : 0);
    for (let yy = start; yy <= end; ++yy) {
        let v = yy / verticalSubdivisions;
        let y = height * v;
        let ringRadius;
        if (yy < 0) {
            y = 0;
            v = 1;
            ringRadius = bottomRadius;
        } else if (yy > verticalSubdivisions) {
            y = height;
            v = 1;
            ringRadius = topRadius;
        } else {
            ringRadius = bottomRadius + (topRadius - bottomRadius) * (yy / verticalSubdivisions);
        }
        if (yy === -2 || yy === verticalSubdivisions + 2) {
            ringRadius = 0;
            v = 0;
        }
        y -= height / 2;
        for (let ii = 0; ii < vertsAroundEdge; ++ii) {
            const sin = Math.sin((ii * Math.PI * 2) / radialSubdivisions);
            const cos = Math.cos((ii * Math.PI * 2) / radialSubdivisions);
            positions.push(sin * ringRadius, y, cos * ringRadius);
            if (yy < 0) {
                normals.push(0, -1, 0);
            } else if (yy > verticalSubdivisions) {
                normals.push(0, 1, 0);
            } else if (ringRadius === 0.0) {
                normals.push(0, 0, 0);
            } else {
                normals.push(sin * cosSlant, sinSlant, cos * cosSlant);
            }
            texcoords.push(ii / radialSubdivisions, 1 - v);
        }
    }
    for (let yy = 0; yy < verticalSubdivisions + extra; ++yy) {
        if ((yy === 1 && topCap) || (yy === verticalSubdivisions + extra - 2 && bottomCap)) {
            continue;
        }
        for (let ii = 0; ii < radialSubdivisions; ++ii) {
            indices.push(vertsAroundEdge * (yy + 0) + 0 + ii, vertsAroundEdge * (yy + 0) + 1 + ii, vertsAroundEdge * (yy + 1) + 1 + ii);
            indices.push(vertsAroundEdge * (yy + 0) + 0 + ii, vertsAroundEdge * (yy + 1) + 1 + ii, vertsAroundEdge * (yy + 1) + 0 + ii);
        }
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
/**
 * Creates cylinder vertices. The cylinder will be created around the origin
 * along the y-axis.
 *
 * @param params
 * @param params.radius Radius of cylinder. Default = 1
 * @param params.height Height of cylinder. Default = 1
 * @param params.radialSubdivisions The number of subdivisions around the cylinder. Default = 24
 * @param params.verticalSubdivisions The number of subdivisions down the cylinder. Default = 1
 * @param params.topCap Create top cap. Default = true.
 * @param params.bottomCap Create bottom cap. Default = true.
 * @return The created vertices.
 */
export function createCylinderVertices({ radius = 1, height = 1, radialSubdivisions = 24, verticalSubdivisions = 1, topCap = true, bottomCap = true } = {}) {
    return createTruncatedConeVertices({
        bottomRadius: radius,
        topRadius: radius,
        height,
        radialSubdivisions,
        verticalSubdivisions,
        topCap,
        bottomCap,
    });
}
/**
 * Creates vertices for a torus
 *
 * @param params
 * @param params.radius radius of center of torus circle. Default = 1
 * @param params.thickness radius of torus ring. Default = 0.24
 * @param params.radialSubdivisions The number of subdivisions around the torus. Default = 24
 * @param params.bodySubdivisions The number of subdivisions around the body torus. Default = 12
 * @param params.startAngle start angle in radians. Default = 0.
 * @param params.endAngle end angle in radians. Default = Math.PI * 2.
 * @return The created vertices.
 */
export function createTorusVertices({ radius = 1, thickness = 0.24, radialSubdivisions = 24, bodySubdivisions = 12, startAngle = 0, endAngle = Math.PI * 2 } = {}) {
    if (radialSubdivisions < 3) {
        throw new Error('radialSubdivisions must be 3 or greater');
    }
    if (bodySubdivisions < 3) {
        throw new Error('verticalSubdivisions must be 3 or greater');
    }
    const range = endAngle - startAngle;
    const radialParts = radialSubdivisions + 1;
    const bodyParts = bodySubdivisions + 1;
    const numVertices = radialParts * bodyParts;
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    const indices = createAugmentedTypedArray(3, radialSubdivisions * bodySubdivisions * 2, Uint16Array);
    for (let slice = 0; slice < bodyParts; ++slice) {
        const v = slice / bodySubdivisions;
        const sliceAngle = v * Math.PI * 2;
        const sliceSin = Math.sin(sliceAngle);
        const ringRadius = radius + sliceSin * thickness;
        const ny = Math.cos(sliceAngle);
        const y = ny * thickness;
        for (let ring = 0; ring < radialParts; ++ring) {
            const u = ring / radialSubdivisions;
            const ringAngle = startAngle + u * range;
            const xSin = Math.sin(ringAngle);
            const zCos = Math.cos(ringAngle);
            const x = xSin * ringRadius;
            const z = zCos * ringRadius;
            const nx = xSin * sliceSin;
            const nz = zCos * sliceSin;
            positions.push(x, y, z);
            normals.push(nx, ny, nz);
            texcoords.push(u, 1 - v);
        }
    }
    for (let slice = 0; slice < bodySubdivisions; ++slice) {
        for (let ring = 0; ring < radialSubdivisions; ++ring) {
            const nextRingIndex = 1 + ring;
            const nextSliceIndex = 1 + slice;
            indices.push(radialParts * slice + ring, radialParts * nextSliceIndex + ring, radialParts * slice + nextRingIndex);
            indices.push(radialParts * nextSliceIndex + ring, radialParts * nextSliceIndex + nextRingIndex, radialParts * slice + nextRingIndex);
        }
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
/**
 * Creates disc vertices. The disc will be in the xz plane, centered at
 * the origin. When creating, at least 3 divisions, or pie
 * pieces, need to be specified, otherwise the triangles making
 * up the disc will be degenerate. You can also specify the
 * number of radial pieces `stacks`. A value of 1 for
 * stacks will give you a simple disc of pie pieces.  If you
 * want to create an annulus you can set `innerRadius` to a
 * value > 0. Finally, `stackPower` allows you to have the widths
 * increase or decrease as you move away from the center. This
 * is particularly useful when using the disc as a ground plane
 * with a fixed camera such that you don't need the resolution
 * of small triangles near the perimeter. For example, a value
 * of 2 will produce stacks whose outside radius increases with
 * the square of the stack index. A value of 1 will give uniform
 * stacks.
 *
 * @param params
 * @param params.radius Radius of the ground plane. Default = 1
 * @param params.divisions Number of triangles in the ground plane (at least 3). Default = 24
 * @param params.stacks Number of radial divisions. Default = 1
 * @param params.innerRadius Default = 0
 * @param params.stackPower Power to raise stack size to for decreasing width. Default = 1
 * @return The created vertices.
 */
export function createDiscVertices({ radius = 1, divisions = 24, stacks = 1, innerRadius = 0, stackPower = 1 } = {}) {
    if (divisions < 3) {
        throw new Error('divisions must be at least 3');
    }
    // Note: We don't share the center vertex because that would
    // mess up texture coordinates.
    const numVertices = (divisions + 1) * (stacks + 1);
    const positions = createAugmentedTypedArray(3, numVertices, Float32Array);
    const normals = createAugmentedTypedArray(3, numVertices, Float32Array);
    const texcoords = createAugmentedTypedArray(2, numVertices, Float32Array);
    const indices = createAugmentedTypedArray(3, stacks * divisions * 2, Uint16Array);
    let firstIndex = 0;
    const radiusSpan = radius - innerRadius;
    const pointsPerStack = divisions + 1;
    // Build the disk one stack at a time.
    for (let stack = 0; stack <= stacks; ++stack) {
        const stackRadius = innerRadius + radiusSpan * Math.pow(stack / stacks, stackPower);
        for (let i = 0; i <= divisions; ++i) {
            const theta = (2.0 * Math.PI * i) / divisions;
            const x = stackRadius * Math.cos(theta);
            const z = stackRadius * Math.sin(theta);
            positions.push(x, 0, z);
            normals.push(0, 1, 0);
            texcoords.push(1 - i / divisions, stack / stacks);
            if (stack > 0 && i !== divisions) {
                // a, b, c and d are the indices of the vertices of a quad.  unless
                // the current stack is the one closest to the center, in which case
                // the vertices a and b connect to the center vertex.
                const a = firstIndex + (i + 1);
                const b = firstIndex + i;
                const c = firstIndex + i - pointsPerStack;
                const d = firstIndex + (i + 1) - pointsPerStack;
                // Make a quad of the vertices a, b, c, d.
                indices.push(a, b, c);
                indices.push(a, c, d);
            }
        }
        firstIndex += divisions + 1;
    }
    return {
        position: positions.typedArray,
        normal: normals.typedArray,
        texcoord: texcoords.typedArray,
        indices: indices.typedArray,
    };
}
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
