export const createStorageBuffer = (gpu, { label = 'storage buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC } = {}) => {
    usage |= GPUBufferUsage.STORAGE;

    return gpu.device.createBuffer({
        label,
        size,
        usage,
    });
};

export const createUniformBuffer = (gpu, { label = 'uniform buffer', size = null, usage = GPUBufferUsage.COPY_DST } = {}) => {
    usage |= GPUBufferUsage.UNIFORM;
    return gpu.device.createBuffer({
        label,
        size,
        usage,
    });
};

export const createBuffer = (gpu, { label = 'buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC } = {}) => {
    return gpu.device.createBuffer({
        label,
        size,
        usage,
    });
};
