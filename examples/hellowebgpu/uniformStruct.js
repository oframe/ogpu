import { createUniformBuffer } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

// Build a standalone single-struct uniform with its own GPU buffer from a
// pipeline's reflected struct def (e.g. `pipeline.defs.uniforms.scaleUniform`).
// Returns a `gui.uniform`-compatible target ({ uniforms, uniformBuffer, gpu })
// with a `set(values)` that updates the view and uploads it.
export function makeUniformStruct(gpu, def, values, label) {
    const uniforms = makeStructuredView(def);
    const uniformBuffer = createUniformBuffer(gpu, { label, size: uniforms.arrayBuffer.byteLength });
    const target = {
        uniforms,
        uniformBuffer,
        gpu,
        set(next) {
            uniforms.set(next);
            gpu.device.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);
        },
    };
    target.set(values);
    return target;
}
