import { makeStructuredView } from 'webgpu-utils';
import { RenderPipeline } from '@core/RenderPipeline.js';
import { FullscreenTriangle } from '@core/primitives/FullscreenTriangle.js';
import { createUniformBuffer } from '@utils/BufferUtils';

// One shared covering-triangle geometry per gpu context — every pass binds the
// same two tiny vertex buffers.
const triangles = new WeakMap();
function getTriangle(gpu) {
    let tri = triangles.get(gpu);
    if (!tri) {
        tri = new FullscreenTriangle(gpu);
        triangles.set(gpu, tri);
    }
    return tri;
}

/**
 * Non-Mesh fullscreen pass: RenderPipeline (no depth, no culling) + shared
 * FullscreenTriangle + its own structured-view uniform buffer + a group(0)
 * bind group resolved by reflection. The workhorse of the post stack.
 *
 * Exposes `.uniforms`/`.uniformBuffer`/`.gpu` so `gui.uniform(pass, key)`
 * works on it directly.
 */
export class FullscreenPass {
    constructor(gpu, { label = 'fullscreen-pass', code = ``, targets, blending = {}, transparent = false, constants = {} } = {}) {
        this.gpu = gpu;
        this.label = label;

        this.geometry = getTriangle(gpu);
        this.pipeline = new RenderPipeline(gpu, {
            label,
            code,
            vertexBuffers: this.geometry.bufferLayouts,
            cullMode: 'none',
            depthStencil: false,
            targets,
            blending,
            transparent,
            constants,
        });

        this._initUniforms();

        // key → { bindings, group } — one pipeline can serve many bind sets
        // per frame (e.g. a bloom mip chain), each memoized under its own key.
        this._groups = new Map();
    }

    _initUniforms() {
        const def = this.pipeline.defs.uniforms?.uniforms;
        if (def) {
            this.uniforms = makeStructuredView(def);
            this.uniformBuffer = createUniformBuffer(this.gpu, {
                label: `${this.label}-uniforms`,
                size: this.uniforms.arrayBuffer.byteLength,
            });
        } else {
            this.uniforms = null;
            this.uniformBuffer = null;
        }
        this._defs = this.pipeline.defs;
    }

    /**
     * Declare group(0) resources by shader binding name:
     * `pass.setBindings({ tMap: view, mapSampler: sampler, extra: { buffer } })`.
     * The pass's own uniform buffer (if the shader declares `uniforms`) is bound
     * automatically. Identity-memoized per `key` — passing the same resources
     * every frame is free; any changed resource rebuilds that key's bind group
     * lazily. Use distinct keys to keep several bind sets alive at once
     * (mip chains, ping-pong variants).
     */
    setBindings(bindings = {}, key = 'default') {
        const entry = this._groups.get(key);
        if (entry) {
            const keys = Object.keys(bindings);
            if (keys.length === Object.keys(entry.bindings).length && keys.every((k) => entry.bindings[k] === bindings[k])) return;
        }
        this._groups.set(key, { bindings, group: null });
    }

    _buildBindGroup(entry) {
        const defs = this.pipeline.defs;
        const entries = [];

        if (this.uniformBuffer) {
            entries.push({ binding: defs.uniforms.uniforms.binding, resource: { buffer: this.uniformBuffer } });
        }

        for (const [name, resource] of Object.entries(entry.bindings)) {
            const def = defs.textures?.[name] ?? defs.samplers?.[name] ?? defs.storages?.[name] ?? (name !== 'uniforms' ? defs.uniforms?.[name] : null);
            if (!def) {
                console.warn(`[post] ${this.label}: shader has no binding named '${name}'`);
                continue;
            }
            entries.push({ binding: def.binding, resource });
        }

        const layout = this.pipeline.bindGroupLayout(0);
        if (!entries.length || !layout) return;

        entry.group = this.gpu.device.createBindGroup({
            label: `${this.label}-bind-group`,
            layout,
            entries,
        });
    }

    /**
     * Record one fullscreen render pass on `encoder`. Pass either a single
     * color `view` or a full `colorAttachments` array (MRT / custom ops).
     */
    draw(encoder, { view, colorAttachments = null, loadOp = 'clear', clearValue = { r: 0, g: 0, b: 0, a: 1 }, bindKey = 'default' } = {}) {
        // Hot-reload guard (mirrors Mesh.draw): defs swap on reload — rebuild the
        // structured view (preserving bytes when the layout is unchanged) and
        // invalidate every bind group.
        if (this._defs !== this.pipeline.defs) {
            const prev = this.uniforms;
            this._initUniforms();
            if (prev && this.uniforms && prev.arrayBuffer.byteLength === this.uniforms.arrayBuffer.byteLength) {
                new Uint8Array(this.uniforms.arrayBuffer).set(new Uint8Array(prev.arrayBuffer));
            }
            this._groups.forEach((entry) => (entry.group = null));
        }

        if (this.uniforms) {
            this.gpu.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms.arrayBuffer);
        }

        const entry = this._groups.get(bindKey);
        if (entry && !entry.group) this._buildBindGroup(entry);

        const pass = encoder.beginRenderPass({
            label: `${this.label}-pass`,
            colorAttachments: colorAttachments ?? [{ view, clearValue, loadOp, storeOp: 'store' }],
        });

        pass.setPipeline(this.pipeline.pipeline);
        if (entry?.group) pass.setBindGroup(0, entry.group);
        this.geometry.nonInstancedVerts.buffers.forEach((buffer, i) => pass.setVertexBuffer(i, buffer));
        pass.draw(3);
        pass.end();
    }

    dispose() {
        this.pipeline.destroy();
        this.uniformBuffer?.destroy?.();
        this._groups.clear();
    }
}
