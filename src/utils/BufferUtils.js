export const createStorageBuffer = (gpu, { label = 'storage buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC } = {}) => {
    usage |= GPUBufferUsage.STORAGE;

    return gpu.device.createBuffer({
        label,
        size,
        usage,
    });
};

let warnedUniformBuffer = false;

/**
 * @deprecated Back a uniform struct with `UniformBuffer`; a structless uniform
 * buffer is `createBuffer(gpu, { usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })`.
 */
export const createUniformBuffer = (gpu, { label = 'uniform buffer', size = null, usage = GPUBufferUsage.COPY_DST } = {}) => {
    if (!warnedUniformBuffer) {
        warnedUniformBuffer = true;
        console.warn('[ogpu] createUniformBuffer is deprecated: use UniformBuffer for a uniform struct, or createBuffer with UNIFORM usage for raw data');
    }
    return createBuffer(gpu, { label, size, usage: usage | GPUBufferUsage.UNIFORM });
};

export const createBuffer = (gpu, { label = 'buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC } = {}) => {
    return gpu.device.createBuffer({
        label,
        size,
        usage,
    });
};
