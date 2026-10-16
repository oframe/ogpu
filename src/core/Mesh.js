import { Transform } from './Transform';
import { Mat3, Mat4 } from '@math';
import { ENGINE_GROUP, TIME_GROUP, NEEDS_NORMAL, NEEDS_OBJECT } from './Shader.js';

const NO_STATE = Object.freeze({});
const _offsets = [0, 0]; // group(1) dynamic offsets: camera slot, object slot

// Renderable node: geometry + Shader + plain `state` + bind groups. Holds no GPU
// objects of its own — the renderer derives the GPURenderPipeline from
// (shader, state, geometry layout, pass formats) and binds its engine groups:
// group(1) (camera + object slots of the shared PerDrawBuffer) and group(3)
// (time, once per pass). `geometry`,
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

        // depend on worldMatrix only — recomputed when Transform.worldVersion moves,
        // and only the ones the shader reads (Shader.needs); updateDerived() makes
        // both current for CPU readers
        this.normalMatrix = new Mat3();
        this.objectMatrix = new Mat4();
        this._derivedVersion = -1;
        this._derivedMask = 0;
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
        if (groups[ENGINE_GROUP] || groups[TIME_GROUP]) {
            throw new Error(`[mesh ${this.label}] bindGroups[1] and bindGroups[3] must be empty — groups 1 and 3 are the engine's`);
        }
        this._bindGroups = groups;
    }

    // Frees the mesh's engine slot (it holds no GPU objects). A destroyed mesh
    // that draws again takes a new slot. Dropping a mesh without destroy() frees
    // the slot when it's garbage collected.
    destroy() {
        this._slotOwner?.release(this);
    }

    onBeforeRender(f) {
        this.beforeRenderCallbacks.add(f);
        return this;
    }

    onAfterRender(f) {
        this.afterRenderCallbacks.add(f);
        return this;
    }

    updateDerived(needs = NEEDS_NORMAL | NEEDS_OBJECT) {
        if (this._derivedVersion !== this.worldVersion) {
            this._derivedVersion = this.worldVersion;
            this._derivedMask = 0;
        }
        const missing = needs & ~this._derivedMask;
        if (!missing) return;
        if (missing & NEEDS_NORMAL) this.normalMatrix.fromNormalMatrix(this.worldMatrix);
        if (missing & NEEDS_OBJECT) this.objectMatrix.copy(this.worldMatrix).invert();
        this._derivedMask |= missing;
    }

    // called by Renderer.render for every queued mesh, inside its pass. `bound`
    // (optional) skips state the encoder already has.
    draw({ pass, passInfo, renderer, camera, cameraOffset, bound }) {
        this.beforeRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));

        const pipeline = renderer.pipelines.get(this, passInfo);
        if (!pipeline) return; // reported by the cache
        // this mesh's fixed slot, rewritten only if it moved; Renderer.render
        // uploads the dirty slots after the pass
        const objectOffset = renderer.perDraw.writeObject(this);

        if (!bound || bound.pipeline !== pipeline) {
            pass.setPipeline(pipeline);
            if (bound) bound.pipeline = pipeline;
        }
        const groups = this._bindGroups;
        setBindGroup(pass, bound, 0, groups[0] ?? renderer.emptyBindGroup);
        _offsets[0] = cameraOffset;
        _offsets[1] = objectOffset;
        // after writeObject: it may grow the buffer (new bind group)
        pass.setBindGroup(ENGINE_GROUP, renderer.engineBindGroup, _offsets);
        // groups 2 and 3 rarely change between draws: `bound` skips them
        setBindGroup(pass, bound, 2, groups[2] ?? renderer.emptyBindGroup);
        setBindGroup(pass, bound, TIME_GROUP, renderer.timeBindGroup);

        drawGeometry(pass, this.geometry, bound);

        this.afterRenderCallbacks.forEach((cb) => cb && cb({ mesh: this, camera }));
    }
}

function deepFreeze(o) {
    for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    return Object.freeze(o);
}

// What a pass or bundle encoder already has bound, so draws skip repeated
// pipelines, bind groups and buffers. reset() whenever anything else touches the
// encoder — executeBundles clears a pass's state.
export class BoundState {
    constructor() {
        this.groups = [];
        this.vertex = [];
        this.reset();
    }

    reset() {
        this.pipeline = null;
        this.groups.length = 0;
        this.vertex.length = 0;
        this.index = null;
        this.indexFormat = null;
        return this;
    }
}

function setBindGroup(pass, bound, index, group) {
    if (bound) {
        if (bound.groups[index] === group) return;
        bound.groups[index] = group;
    }
    pass.setBindGroup(index, group);
}

function setVertexBuffer(pass, bound, slot, buffer) {
    if (bound) {
        if (bound.vertex[slot] === buffer) return;
        bound.vertex[slot] = buffer;
    }
    pass.setVertexBuffer(slot, buffer);
}

// vertex/instance/index binding + the draw call (indexed, indirect or plain);
// `bound` (a BoundState) skips buffers already set
export function drawGeometry(pass, geometry, bound) {
    const verts = geometry.nonInstancedVerts;
    const vertexBuffers = verts.buffers;
    for (let i = 0; i < vertexBuffers.length; i++) setVertexBuffer(pass, bound, i, vertexBuffers[i]);

    const instanced = geometry.hasInstancedAttributes;
    if (instanced) {
        const instanceBuffers = geometry.instancedVerts.buffers;
        for (let i = 0; i < instanceBuffers.length; i++) {
            setVertexBuffer(pass, bound, vertexBuffers.length + i, instanceBuffers[i]);
        }
    }

    const drawBuffer = geometry.drawBuffer;
    const drawOffset = geometry.drawBufferOffset ?? 0;
    const instanceCount = instanced ? geometry.instancedVerts.numElements : 1;

    if (verts.indexBuffer) {
        if (!bound || bound.index !== verts.indexBuffer || bound.indexFormat !== verts.indexFormat) {
            pass.setIndexBuffer(verts.indexBuffer, verts.indexFormat);
            if (bound) {
                bound.index = verts.indexBuffer;
                bound.indexFormat = verts.indexFormat;
            }
        }
        if (drawBuffer) pass.drawIndexedIndirect(drawBuffer, drawOffset);
        else pass.drawIndexed(verts.numElements, instanceCount);
    } else if (drawBuffer) {
        pass.drawIndirect(drawBuffer, drawOffset);
    } else {
        pass.draw(verts.numElements, instanceCount);
    }
}
