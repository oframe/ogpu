@group(0) @binding(0) var<storage, read> positionBuffer : array<f32>;
@group(0) @binding(1) var<storage, read> normalBuffer : array<f32>;
@group(0) @binding(2) var<storage, read> weightBuffer : array<f32>;
@group(0) @binding(3) var<storage, read> boneIndexBuffer : array<u32>;

@group(0) @binding(4) var<storage, read> invBoneMatrixBuffer : array<mat4x4f>;
@group(0) @binding(5) var<storage, read> boneMatrixBuffer : array<mat4x4f>;

@group(0) @binding(6) var<storage, read_write> positionOutBuffer : array<f32>;
@group(0) @binding(7) var<storage, read_write> normalOutBuffer : array<f32>;

fn getPosition(index: u32) -> vec3f {
    return vec3f(
        positionBuffer[index * 3], 
        positionBuffer[index * 3 + 1], 
        positionBuffer[index * 3 + 2]);
}

fn getNormal(index: u32) -> vec3f {
    return vec3f(
        normalBuffer[index * 3], 
        normalBuffer[index * 3 + 1], 
        normalBuffer[index * 3 + 2]);
}

fn getWeights(index: u32) -> vec4f {
    return vec4f(
        weightBuffer[index * 4], 
        weightBuffer[index * 4 + 1], 
        weightBuffer[index * 4 + 2], 
        weightBuffer[index * 4 + 3]);
}

fn getBoneIndices(index: u32) -> vec4u {
    return vec4u(
        boneIndexBuffer[index * 4], 
        boneIndexBuffer[index * 4 + 1], 
        boneIndexBuffer[index * 4 + 2], 
        boneIndexBuffer[index * 4 + 3]);
}

fn getMatrix(indices: vec4u, weights: vec4f) -> mat4x4f {
    
    let boneMatrixA = boneMatrixBuffer[indices.x] * invBoneMatrixBuffer[indices.x];
    let boneMatrixB = boneMatrixBuffer[indices.y] * invBoneMatrixBuffer[indices.y];
    let boneMatrixC = boneMatrixBuffer[indices.z] * invBoneMatrixBuffer[indices.z];
    let boneMatrixD = boneMatrixBuffer[indices.w] * invBoneMatrixBuffer[indices.w];

    return 
    boneMatrixA * weights.x + 
    boneMatrixB * weights.y + 
    boneMatrixC * weights.z + 
    boneMatrixD * weights.w;
    
}

@compute @workgroup_size(64, 1, 1) fn skin(
    @builtin(global_invocation_id) global_invocation_id : vec3u,
) {

    let id = global_invocation_id.x;

    if(id >= arrayLength(&positionBuffer) / 3u) {
        return;
    }

    let position = getPosition(id);
    let normal = getNormal(id);
    let weights = getWeights(id);
    let boneIndices = getBoneIndices(id);

    let pos = (getMatrix(boneIndices, weights) * vec4f(position, 1.0)).xyz;
    let n = (getMatrix(boneIndices, weights) * vec4f(normal, 0.0)).xyz;

    positionOutBuffer[id * 3] = pos.x;
    positionOutBuffer[id * 3 + 1] = pos.y;
    positionOutBuffer[id * 3 + 2] = pos.z;

    normalOutBuffer[id * 3] = n.x;
    normalOutBuffer[id * 3 + 1] = n.y;
    normalOutBuffer[id * 3 + 2] = n.z;
   
}