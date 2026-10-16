import { Transform } from './Transform.js';
import { ENGINE_GROUP } from './Shader.js';
import { drawGeometry, BoundState, bindPassGroups } from './Mesh.js';

const _offsets = [0, 0];

// Transform whose Mesh descendants replay from a GPURenderBundle captured by
// record(), one bundle per pass kind + camera slot. A group, not a bundle: it
// owns up to MAX_BUNDLES of them and re-encodes them itself. When it fits, what
// `stale` tracks and what re-encodes on its own: src/core/CLAUDE.md.

// bundles kept per group; render() outside Renderer.update without
// perDraw.reset() would otherwise mint one per call (the camera slot climbs)
const MAX_BUNDLES = 16;
export class RenderBundleGroup extends Transform {
    constructor({ label = 'render-bundle-group' } = {}) {
        super();
        this.label = label;
        this.isRenderBundleGroup = true;
        this._meshes = null; // recorded draw list, null until record()
        this._offsets = null; // their object-slot offsets the bundles baked
        this._snapshot = null; // per descendant: node, visible, then for meshes shader, version, state, geometry, bindGroups, g0, g2, g3, drawBuffer, drawBufferOffset
        this._structure = -1;
        this._bundles = new Map();
        this._staleWarned = false;
        this._staleTick = 0;
        this._unrecordedWarned = false;
    }

    get recorded() {
        return this._meshes !== null;
    }

    // Snapshot the subtree now. Bundles are (re)encoded lazily per pass kind.
    record() {
        const meshes = [];
        const snap = [];
        let scissored = false;
        let unordered = false; // transparent / depth-test-off / renderOrder / callbacks
        for (const child of this.children) {
            child.traverse((node) => {
                if (node.scissor) scissored = true;
                snap.push(node, node.visible);
                if (node.draw) {
                    const g = node.bindGroups;
                    snap.push(node.shader, node.shader.version, node.state, node.geometry, g, g[0], g[2], g[3], node.geometry.drawBuffer, node.geometry.drawBufferOffset);
                }
                if (!node.visible) return true;
                if (node.draw && !node.manualRender) {
                    meshes.push(node);
                    const st = node.state;
                    if (st.transparent || st.depthTest === false || node.renderOrder || node.beforeRenderCallbacks.size || node.afterRenderCallbacks.size) {
                        unordered = true;
                    }
                }
            });
        }
        if (scissored && !this._scissorWarned) {
            this._scissorWarned = true;
            console.warn(`[render-bundle-group ${this.label}] a child has its own scissor — it doesn't apply inside a recording; only the group's (and its ancestors') scissor clips the replay`);
        }
        if (unordered && !this._orderWarned) {
            this._orderWarned = true;
            console.warn(`[render-bundle-group ${this.label}] recorded a transparent, depth-test-off, renderOrder'd or callback mesh — the replay ignores all of that and runs before every live draw`);
        }
        meshes.sort(drawOrder);
        this._meshes = meshes;
        this._offsets = null;
        this._snapshot = snap;
        this._structure = this.structureVersion;
        this._bundles.clear();
        this._staleWarned = false;
        this._skippedWarned = false;
        return this;
    }

    // True when the subtree no longer matches what record() saw. O(descendants).
    get stale() {
        const snap = this._snapshot;
        if (!snap) return false;
        if (this._structure !== this.structureVersion) return true;
        for (let i = 0; i < snap.length; ) {
            const node = snap[i];
            if (node.visible !== snap[i + 1]) return true;
            i += 2;
            if (!node.draw) continue;
            const g = node.bindGroups;
            if (
                node.shader !== snap[i] ||
                node.shader.version !== snap[i + 1] ||
                node.state !== snap[i + 2] ||
                node.geometry !== snap[i + 3] ||
                g !== snap[i + 4] ||
                g[0] !== snap[i + 5] ||
                g[2] !== snap[i + 6] ||
                g[3] !== snap[i + 7] ||
                node.geometry.drawBuffer !== snap[i + 8] ||
                node.geometry.drawBufferOffset !== snap[i + 9]
            ) {
                return true;
            }
            i += 10;
        }
        return false;
    }

    // Renderer: refresh the recorded meshes' engine slots (only moved ones write).
    // A mesh that came back with another slot (destroyed, or drawn by another
    // renderer) would leave the bundles reading someone else's — re-encode them.
    _writeSlots(perDraw) {
        const meshes = this._meshes;
        const baked = this._offsets;
        let moved = !baked || baked.length !== meshes.length;
        for (let i = 0; i < meshes.length; i++) {
            const offset = perDraw.writeObject(meshes[i]);
            if (!moved && baked[i] !== offset) moved = true;
        }
        if (moved && baked) this._bundles.clear();
    }

    // Renderer: the bundle for this pass kind + camera slot, encoded on first use.
    // Re-encoded (same recorded list) when the engine buffer or the pipeline
    // cache was replaced — a bundle over a destroyed buffer can't replay — or when
    // a mesh left out for lack of a pipeline has one now.
    _bundleFor(renderer, passInfo, cameraOffset) {
        const key = `${passInfo.key}|${cameraOffset}`;
        const perDraw = renderer.perDraw;
        let entry = this._bundles.get(key);
        if (entry && entry.buffer === perDraw.buffer && entry.pipelines === renderer.pipelines.version && !pipelineArrived(renderer, passInfo, entry.skipped)) {
            if (this._bundles.size > 1) {
                // least recently used goes first when the cap is hit
                this._bundles.delete(key);
                this._bundles.set(key, entry);
            }
            return entry.bundle;
        }
        const skipped = [];
        entry = {
            bundle: this._encode(renderer, passInfo, cameraOffset, skipped),
            buffer: perDraw.buffer,
            pipelines: renderer.pipelines.version,
            skipped: skipped.length ? skipped : null,
        };
        const bundles = this._bundles;
        bundles.delete(key);
        for (const [k, e] of bundles) if (e.buffer !== perDraw.buffer) bundles.delete(k);
        if (bundles.size >= MAX_BUNDLES) bundles.delete(bundles.keys().next().value);
        bundles.set(key, entry);
        return entry.bundle;
    }

    _encode(renderer, passInfo, cameraOffset, skipped) {
        const { device } = renderer.gpu;
        const perDraw = renderer.perDraw;
        const meshes = this._meshes;
        // slots first: acquiring one may grow the buffer (new engine bind group)
        const offsets = (this._offsets = new Uint32Array(meshes.length));
        for (let i = 0; i < meshes.length; i++) offsets[i] = perDraw.writeObject(meshes[i]);
        const engine = renderer.engineBindGroup;
        const encoder = device.createRenderBundleEncoder({
            label: `${this.label}-bundle`,
            colorFormats: passInfo.colorFormats,
            depthStencilFormat: passInfo.depthFormat ?? undefined,
            sampleCount: passInfo.sampleCount,
        });
        const bound = new BoundState();
        bindPassGroups(encoder, renderer, bound);
        const empty = renderer.emptyBindGroup;
        _offsets[0] = cameraOffset;
        for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const pipeline = renderer.pipelines.get(mesh, passInfo);
            if (!pipeline) {
                skipped.push(mesh); // reported by the cache
                continue;
            }
            if (bound.pipeline !== pipeline) {
                encoder.setPipeline(pipeline);
                bound.pipeline = pipeline;
            }
            const groups = mesh.bindGroups;
            setGroup(encoder, bound, 0, groups[0] ?? empty);
            _offsets[1] = offsets[i];
            encoder.setBindGroup(ENGINE_GROUP, engine, _offsets);
            const g2 = groups[2] ?? empty;
            if (bound.g2 !== g2) {
                encoder.setBindGroup(2, g2);
                bound.g2 = g2;
            }
            drawGeometry(encoder, mesh.geometry, bound);
        }
        if (skipped.length && !this._skippedWarned) {
            this._skippedWarned = true;
            console.warn(`[render-bundle-group ${this.label}] ${skipped.length} recorded mesh(es) have no pipeline (reported by the pipeline cache) — left out of the bundle until one is available`);
        }
        return encoder.finish({ label: `${this.label}-bundle` });
    }
}

// a mesh the bundle left out (no pipeline) has one now — e.g. its shader was rebuilt
function pipelineArrived(renderer, passInfo, skipped) {
    if (!skipped) return false;
    for (let i = 0; i < skipped.length; i++) if (renderer.pipelines.get(skipped[i], passInfo)) return true;
    return false;
}

function setGroup(encoder, bound, index, group) {
    if (bound.groups[index] === group) return;
    encoder.setBindGroup(index, group);
    bound.groups[index] = group;
}

// shader, then state, then geometry, then first bind group — adjacent draws
// share as much bound state as possible
function drawOrder(a, b) {
    if (a.shader.id !== b.shader.id) return a.shader.id - b.shader.id;
    if (a.state !== b.state) return stateId(a.state) - stateId(b.state);
    if (a.geometry !== b.geometry) return objectId(a.geometry) - objectId(b.geometry);
    return objectId(a.bindGroups[0]) - objectId(b.bindGroups[0]);
}

const _ids = new WeakMap();
let _nextId = 1;
function objectId(o) {
    if (!o) return 0;
    let id = _ids.get(o);
    if (id === undefined) _ids.set(o, (id = _nextId++));
    return id;
}
const stateId = objectId;
