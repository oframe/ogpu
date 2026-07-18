import { Transform } from './Transform';
import { Mat3, Mat4, Vec2 } from '@math';
import { makeStructuredView } from 'webgpu-utils';

const _res = /* @__PURE__ */ new Vec2();

// Renderable node: owns a structured uniform view + bind groups, binds a pipeline +
// geometry, and issues the draw call (writes the standard per-frame uniforms). The
// uniform buffer itself is NOT mesh-owned — every draw allocates a fresh slice of
// the renderer's shared `PerDrawBuffer` and re-bases group(0) via a dynamic offset.
//
// `bindGroups` is REQUIRED — either a `GPUBindGroup[]` array or a factory
// `(uniformResource) => GPUBindGroup[]`. The factory form receives a slice
// descriptor (`{buffer, offset: 0, size: structSize}`) into the shared per-draw
// buffer so group(0) can bind it at binding 0. This lets a single pipeline be
// shared across many meshes without their per-object uniforms stomping each other.
export class Mesh extends Transform {
    constructor(gpu, { label = 'basic mesh', pipeline, geometry, bindGroups, manualRender = false, renderOrder = 0, frustumCulled = true } = {}) {
        super();

        if (!gpu) {
            console.error('no webgpu context found');
            return;
        }

        this.label = label;
        this.gpu = gpu;
        this.visible = true;
        this.manualRender = manualRender;
        this.renderOrder = renderOrder;
        this.frustumCulled = frustumCulled;

        if (!geometry) {
            console.error('no geometry provided');
            return;
        }

        this.pipeline = pipeline;
        // Mesh owns the geometry. the pipeline only carries the vertex *layout*
        // (its `vertexBuffers`); many geometries sharing that layout can run
        // through one pipeline — they just bind different buffers per-draw.
        this.geometry = geometry;
        this.modelViewMatrix = new Mat4();
        this.normalMatrix = new Mat3();
        this.objectMatrix = new Mat4();

        // Each mesh owns a structured uniform view, built from the pipeline's
        // reflected uniforms struct. bind groups are supplied by the caller (array
        // or factory).
        this.uniforms = makeStructuredView(pipeline.defs.uniforms.uniforms);
        this.structSize = this.uniforms.arrayBuffer.byteLength;
        // slice descriptor for group(0) binding(0): the shared buffer, struct-sized,
        // re-based per draw via dynamic offset
        this.uniformResource = {
            buffer: gpu.renderer.perDraw.buffer,
            offset: 0,
            size: this.structSize,
        };
        this.bindGroups = typeof bindGroups === 'function' ? bindGroups(this.uniformResource) : bindGroups;
        this._defs = pipeline.defs;

        this.beforeRenderCallbacks = new Set();
        this.afterRenderCallbacks = new Set();
    }

    onBeforeRender(f) {
        this.beforeRenderCallbacks.add(f);
        return this;
    }

    onAfterRender(f) {
        this.afterRenderCallbacks.add(f);
        return this;
    }

    draw({ camera = null, pass, time = 0, resolution = null } = {}) {
        // Hot-reload guard: pipeline.defs is swapped on each reload. Rebuild the
        // structured view from the new defs, preserving values when the byte
        // length is unchanged, else update the slice size and warn (bind groups
        // still reference the old size and must be recreated).
        if (this._defs !== this.pipeline.defs) {
            const next = makeStructuredView(this.pipeline.defs.uniforms.uniforms);
            if (this.uniforms.arrayBuffer.byteLength === next.arrayBuffer.byteLength) {
                new Uint8Array(next.arrayBuffer).set(new Uint8Array(this.uniforms.arrayBuffer));
            } else {
                this.structSize = next.arrayBuffer.byteLength;
                this.uniformResource.size = this.structSize;
                console.warn(`[hot] ${this.label}: uniform layout changed — bind groups must be recreated`);
            }
            this.uniforms = next;
            this._defs = this.pipeline.defs;
        }

        // Shaders declare only the subset of standard uniforms they use, so a
        // given view may be undefined — optional-chain the writes so missing
        // ones are skipped (matches the old behaviour where wgpu-matrix
        // silently discarded writes to a missing target).
        const views = this.uniforms.views;

        if (camera) {
            views.projectionMatrix?.set(camera.projectionMatrix);
            views.cameraPosition?.set(camera.worldPosition);
            views.viewMatrix?.set(camera.viewMatrix);

            this.modelViewMatrix.copy(camera.viewMatrix).multiply(this.worldMatrix);
            views.modelViewMatrix?.set(this.modelViewMatrix);

            this.normalMatrix.fromNormalMatrix(this.worldMatrix);
            views.normalMatrix?.set(this.normalMatrix);
            views.cameraQuaternion?.set(camera.worldQuaternion ?? camera.quaternion);
        }

        views.modelMatrix?.set(this.worldMatrix);
        this.objectMatrix.copy(this.worldMatrix).invert();
        views.objectMatrix?.set(this.objectMatrix);

        this.beforeRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));

        this.uniforms.set({
            resolution: _res.set(resolution?.[0] ?? this.gpu.canvas.width, resolution?.[1] ?? this.gpu.canvas.height),
            time: time,
        });

        // a shader that never reads its uniforms has no binding(0) in the reflected
        // layout — no slice to alloc, and group 0 must bind without a dynamic offset
        const dynamic = this.pipeline.hasDynamicUniform;
        const perDraw = this.gpu.renderer.perDraw;
        let offset = 0;
        if (dynamic) {
            offset = perDraw.alloc(this.uniforms.arrayBuffer.byteLength);
            this.gpu.device.queue.writeBuffer(perDraw.buffer, offset, this.uniforms.arrayBuffer);
        }

        // ponytail: dropped the redundant-bind dedup — external pass.setPipeline calls on a
        // shared pass desync an expando cache; upgrade path is a renderer-owned per-pass cache
        // if profiling ever shows redundant setPipeline calls matter.
        pass.setPipeline(this.pipeline.pipeline);

        this.bindGroups.forEach((bindGroup, i) => {
            if (i === 0 && dynamic) {
                pass.setBindGroup(0, bindGroup, [offset]);
            } else {
                pass.setBindGroup(i, bindGroup);
            }
        });

        let bindingOffset = 0;

        this.geometry.nonInstancedVerts.buffers.forEach((buffer, i) => {
            pass.setVertexBuffer(i, buffer);
            bindingOffset++;
        });

        if (this.geometry.hasInstancedAttributes) {
            this.geometry.instancedVerts.buffers.forEach((buffer, i) => {
                pass.setVertexBuffer(bindingOffset + i, buffer);
            });
        }

        const drawBuffer = this.geometry.drawBuffer;
        const instanceCount = this.geometry.hasInstancedAttributes ? this.geometry.instancedVerts.numElements : 1;

        if (this.geometry.nonInstancedVerts.indexBuffer) {
            pass.setIndexBuffer(this.geometry.nonInstancedVerts.indexBuffer, this.geometry.nonInstancedVerts.indexFormat);
            if (drawBuffer) {
                pass.drawIndexedIndirect(drawBuffer, 0);
            } else {
                pass.drawIndexed(this.geometry.nonInstancedVerts.numElements, instanceCount);
            }
        } else {
            if (drawBuffer) {
                pass.drawIndirect(drawBuffer, 0);
            } else {
                pass.draw(this.geometry.nonInstancedVerts.numElements, instanceCount);
            }
        }

        this.afterRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));
    }
}
