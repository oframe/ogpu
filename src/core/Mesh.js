import { Transform } from './Transform';
import { Mat3, Mat4 } from '@math';
import { ENGINE_GROUP } from './Shader.js';

const NO_STATE = Object.freeze({});
const _offsets = [0, 0]; // group(1) dynamic offsets: camera slice, object slice

// Renderable node: geometry + Shader + plain `state` + bind groups. Holds no GPU
// objects of its own — the renderer derives the GPURenderPipeline from
// (shader, state, geometry layout, pass formats) and binds its engine group at
// group(1) (camera + object slices of the shared PerDrawBuffer). `geometry`,
// `shader`, `state` and `bindGroups` are all swappable; bind groups belong to
// the shader, so a new shader needs new bind groups.
export class Mesh extends Transform {
    constructor({ label = 'mesh', geometry, shader, state = NO_STATE, bindGroups = [], manualRender = false, renderOrder = 0, frustumCulled = true, ...rest } = {}) {
        super();

        if (rest.device) {
            throw new Error(`[mesh] Mesh takes no gpu: new Mesh({ geometry, shader, state, bindGroups }) (ogpu 0.9)`);
        }

        this.label = label;
        this.visible = true;
        this.manualRender = manualRender;
        this.renderOrder = renderOrder;
        this.frustumCulled = frustumCulled;
        this.beforeRenderCallbacks = new Set();
        this.afterRenderCallbacks = new Set();

        if (!geometry) throw new Error(`[mesh ${label}] no geometry provided`);
        if (!shader) throw new Error(`[mesh ${label}] no shader provided`);

        this.geometry = geometry;
        this.shader = shader;
        this.state = state;
        this.bindGroups = bindGroups;

        // depend on worldMatrix only — recomputed when Transform.worldVersion moves
        this.normalMatrix = new Mat3();
        this.objectMatrix = new Mat4();
        this._derivedVersion = -1;
    }

    get state() {
        return this._state;
    }

    // frozen: the pipeline cache compares states by identity, so a mutation would
    // be silently ignored — replace the object instead
    set state(state) {
        if (!state) state = NO_STATE;
        if (state.blending) deepFreeze(state.blending);
        this._state = Object.freeze(state);
    }

    get bindGroups() {
        return this._bindGroups;
    }

    set bindGroups(groups) {
        if (groups[ENGINE_GROUP]) {
            throw new Error(`[mesh ${this.label}] bindGroups[1] must be empty — group(1) is the engine's`);
        }
        this._bindGroups = groups;
    }

    onBeforeRender(f) {
        this.beforeRenderCallbacks.add(f);
        return this;
    }

    onAfterRender(f) {
        this.afterRenderCallbacks.add(f);
        return this;
    }

    updateDerived() {
        if (this._derivedVersion === this.worldVersion) return;
        this.normalMatrix.fromNormalMatrix(this.worldMatrix);
        this.objectMatrix.copy(this.worldMatrix).invert();
        this._derivedVersion = this.worldVersion;
    }

    // called by Renderer.render for every queued mesh, inside its pass
    draw({ pass, passInfo, renderer, camera, cameraOffset }) {
        this.beforeRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));

        const pipeline = renderer.pipelines.get(this, passInfo);
        if (!pipeline || cameraOffset < 0) return; // reported by the cache / buffer overflow
        this.updateDerived();
        // object slice lands in the CPU mirror; Renderer.render uploads the
        // frame's slices in one writeBuffer after the pass
        const objectOffset = renderer.perDraw.writeObject(this, camera);
        if (objectOffset < 0) return; // per-draw buffer full: drop the draw, keep the pass valid

        pass.setPipeline(pipeline);
        const groups = this._bindGroups;
        pass.setBindGroup(0, groups[0] ?? renderer.emptyBindGroup);
        _offsets[0] = cameraOffset;
        _offsets[1] = objectOffset;
        pass.setBindGroup(ENGINE_GROUP, renderer.engineBindGroup, _offsets);
        for (let i = 2; i < groups.length; i++) {
            pass.setBindGroup(i, groups[i] ?? renderer.emptyBindGroup);
        }

        drawGeometry(pass, this.geometry);

        this.afterRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));
    }
}

function deepFreeze(o) {
    for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    return Object.freeze(o);
}

// vertex/instance/index binding + the draw call (indexed, indirect or plain)
export function drawGeometry(pass, geometry) {
    const verts = geometry.nonInstancedVerts;
    const vertexBuffers = verts.buffers;
    for (let i = 0; i < vertexBuffers.length; i++) pass.setVertexBuffer(i, vertexBuffers[i]);

    const instanced = geometry.hasInstancedAttributes;
    if (instanced) {
        const instanceBuffers = geometry.instancedVerts.buffers;
        for (let i = 0; i < instanceBuffers.length; i++) {
            pass.setVertexBuffer(vertexBuffers.length + i, instanceBuffers[i]);
        }
    }

    const drawBuffer = geometry.drawBuffer;
    const instanceCount = instanced ? geometry.instancedVerts.numElements : 1;

    if (verts.indexBuffer) {
        pass.setIndexBuffer(verts.indexBuffer, verts.indexFormat);
        if (drawBuffer) pass.drawIndexedIndirect(drawBuffer, 0);
        else pass.drawIndexed(verts.numElements, instanceCount);
    } else if (drawBuffer) {
        pass.drawIndirect(drawBuffer, 0);
    } else {
        pass.draw(verts.numElements, instanceCount);
    }
}
