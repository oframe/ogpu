// Raw-buffer helpers. A uniform struct belongs on UniformBuffer; these are for
// plain bytes. `data` (ArrayBuffer or typed array) fills the buffer at creation
// (mappedAtCreation); `size` then defaults to data.byteLength rounded up to 4.

export const createStorageBuffer = (gpu, { label = 'storage buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, data } = {}) => {
    return create(gpu, label, size, usage | GPUBufferUsage.STORAGE, data);
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

export const createBuffer = (gpu, { label = 'buffer', size = null, usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, data } = {}) => {
    return create(gpu, label, size, usage, data);
};

function create(gpu, label, size, usage, data) {
    if (!data) return gpu.device.createBuffer({ label, size, usage });
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (size == null) size = Math.ceil(bytes.byteLength / 4) * 4;
    else if (size < bytes.byteLength) throw new Error(`[${label}] size ${size} is smaller than data (${bytes.byteLength} B)`);
    const buffer = gpu.device.createBuffer({ label, size, usage, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(bytes);
    buffer.unmap();
    return buffer;
}
