// Legacy Mesh path — `new Mesh(gpu, { pipeline, geometry, bindGroups })` with
// standard uniforms written by name into a PerDrawBuffer slice. Kept only while
// the codebase migrates to Mesh({ shader, state, bindGroups }); deleted after.
import { Mat3, Mat4, Vec2 } from '@math';
import { makeStructuredView } from './reflect/index.js';

const _res = /* @__PURE__ */ new Vec2();
const _offsets = [0]; // reused dynamic-offset list for group(0)

// the per-frame uniforms draw() writes by name — see the near-miss check below
const STANDARD_UNIFORMS = ['projectionMatrix', 'viewMatrix', 'modelMatrix', 'modelViewMatrix', 'objectMatrix', 'normalMatrix', 'cameraPosition', 'cameraQuaternion', 'resolution', 'time'];

// stub for shaders that declare no `uniforms` var (vertex-pulled/hardcoded
// geometry) — draw() still reads .views/.set/.arrayBuffer
const NO_UNIFORMS = { views: {}, arrayBuffer: new ArrayBuffer(0), set() {} };

function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

// The legacy mesh owns a structured uniform view + bind groups, binds a pipeline +
// geometry, and issues the draw call (writes the standard per-frame uniforms). The
// uniform buffer itself is NOT mesh-owned — every draw allocates a fresh slice of
// the renderer's shared `PerDrawBuffer` and re-bases group(0) via a dynamic offset.
//
// `bindGroups` is REQUIRED — either a `GPUBindGroup[]` array or a factory
// `(uniformResource) => GPUBindGroup[]`. The factory form receives a slice
// descriptor (`{buffer, offset: 0, size: structSize}`) into the shared per-draw
// buffer so group(0) can bind it at binding 0.
export function initLegacyMesh(mesh, gpu, { label, pipeline, geometry, bindGroups }) {
    if (!gpu) throw new Error(`[mesh ${label}] no webgpu context (gpu) provided`);
    if (!pipeline) throw new Error(`[mesh ${label}] no pipeline provided`);
    if (!geometry) throw new Error(`[mesh ${label}] no geometry provided`);

    mesh.gpu = gpu;
    mesh.pipeline = pipeline;
    // Mesh owns the geometry. the pipeline only carries the vertex *layout*
    // (its `vertexBuffers`); many geometries sharing that layout can run
    // through one pipeline — they just bind different buffers per-draw.
    mesh.geometry = geometry;
    mesh.modelViewMatrix = new Mat4();
    mesh.normalMatrix = new Mat3();
    mesh.objectMatrix = new Mat4();

    // Each mesh owns a structured uniform view, built from the pipeline's
    // reflected uniforms struct. Shaders without a `uniforms` var get the inert stub.
    mesh.uniforms = pipeline.defs.uniforms?.uniforms ? makeStructuredView(pipeline.defs.uniforms.uniforms) : NO_UNIFORMS;
    mesh.structSize = mesh.uniforms.arrayBuffer.byteLength;
    // byte view handed to perDraw.write each draw — cached, not rebuilt per draw
    mesh._bytes = new Uint8Array(mesh.uniforms.arrayBuffer);

    // A misnamed standard uniform is silently skipped at draw time — flag
    // likely typos once, at construction. u-prefixed names (uTime) are a
    // deliberate custom-uniform convention, not near-misses.
    for (const name of Object.keys(mesh.uniforms.views)) {
        if (STANDARD_UNIFORMS.includes(name) || /^u[A-Z]/.test(name)) continue;
        const near = STANDARD_UNIFORMS.find((s) => (s.length >= 8 || name.toLowerCase() === s.toLowerCase()) && editDistance(name.toLowerCase(), s.toLowerCase()) <= 2);
        if (near) console.warn(`[mesh ${label}] uniform '${name}' looks like a misspelling of standard uniform '${near}' — it will never be auto-written`);
    }
    // slice descriptor for group(0) binding(0): the shared buffer, struct-sized,
    // re-based per draw via dynamic offset
    mesh.uniformResource = {
        buffer: gpu.renderer.perDraw.buffer,
        offset: 0,
        size: mesh.structSize,
    };
    mesh.bindGroups = typeof bindGroups === 'function' ? bindGroups(mesh.uniformResource) : bindGroups;
    mesh._defs = pipeline.defs;
}

export function drawLegacyMesh(mesh, { camera = null, pass, time = 0, resolution = null } = {}) {
    // Hot-reload guard: pipeline.defs is swapped on each reload. Rebuild the
    // structured view from the new defs, preserving values when the byte
    // length is unchanged, else update the slice size and warn (bind groups
    // still reference the old size and must be recreated).
    if (mesh._defs !== mesh.pipeline.defs) {
        const nextDef = mesh.pipeline.defs.uniforms?.uniforms;
        const next = nextDef ? makeStructuredView(nextDef) : NO_UNIFORMS;
        if (mesh.uniforms.arrayBuffer.byteLength === next.arrayBuffer.byteLength) {
            new Uint8Array(next.arrayBuffer).set(new Uint8Array(mesh.uniforms.arrayBuffer));
        } else {
            mesh.structSize = next.arrayBuffer.byteLength;
            mesh.uniformResource.size = mesh.structSize;
            console.warn(`[hot] ${mesh.label}: uniform layout changed — bind groups must be recreated`);
        }
        mesh.uniforms = next;
        mesh._bytes = new Uint8Array(next.arrayBuffer);
        mesh._defs = mesh.pipeline.defs;
    }

    // Shaders declare only the subset of standard uniforms they use, so a
    // given view may be undefined — optional-chain the writes so missing
    // ones are skipped.
    const views = mesh.uniforms.views;

    // Derived matrices are computed only when the shader declares them —
    // so mesh.modelViewMatrix / normalMatrix / objectMatrix are stale for
    // shaders that don't read them.
    if (camera) {
        views.projectionMatrix?.set(camera.projectionMatrix);
        views.cameraPosition?.set(camera.worldPosition);
        views.viewMatrix?.set(camera.viewMatrix);

        if (views.modelViewMatrix) {
            mesh.modelViewMatrix.copy(camera.viewMatrix).multiply(mesh.worldMatrix);
            views.modelViewMatrix.set(mesh.modelViewMatrix);
        }
        if (views.normalMatrix) {
            mesh.normalMatrix.fromNormalMatrix(mesh.worldMatrix);
            views.normalMatrix.set(mesh.normalMatrix);
        }
        views.cameraQuaternion?.set(camera.worldQuaternion ?? camera.quaternion);
    }

    views.modelMatrix?.set(mesh.worldMatrix);
    if (views.objectMatrix) {
        mesh.objectMatrix.copy(mesh.worldMatrix).invert();
        views.objectMatrix.set(mesh.objectMatrix);
    }

    mesh.beforeRenderCallbacks.forEach((cb) => cb && cb({ mesh, camera }));

    // scalar views are length-1 typed arrays — same as uniforms.set({ time }),
    // minus the per-draw object literal
    views.resolution?.set(_res.set(resolution?.[0] ?? mesh.gpu.canvas.width, resolution?.[1] ?? mesh.gpu.canvas.height));
    if (views.time) views.time[0] = time;

    // a shader that never reads its uniforms has no binding(0) in the reflected
    // layout — no slice to alloc, and group 0 must bind without a dynamic offset.
    // The slice lands in the CPU mirror; Renderer.render uploads the frame's
    // slices in one writeBuffer after the pass.
    const dynamic = mesh.pipeline.hasDynamicUniform;
    const offset = dynamic ? mesh.gpu.renderer.perDraw.write(mesh._bytes) : 0;
    if (offset < 0) return; // per-draw buffer full: drop this draw, keep the pass valid

    // No redundant-bind dedup — external pass.setPipeline calls on a
    // shared pass desync an expando cache; upgrade path is a renderer-owned per-pass cache
    // if profiling ever shows redundant setPipeline calls matter.
    pass.setPipeline(mesh.pipeline.pipeline);

    mesh.bindGroups.forEach((bindGroup, i) => {
        if (i === 0 && dynamic) {
            _offsets[0] = offset;
            pass.setBindGroup(0, bindGroup, _offsets);
        } else {
            pass.setBindGroup(i, bindGroup);
        }
    });

    let bindingOffset = 0;

    mesh.geometry.nonInstancedVerts.buffers.forEach((buffer, i) => {
        pass.setVertexBuffer(i, buffer);
        bindingOffset++;
    });

    if (mesh.geometry.hasInstancedAttributes) {
        mesh.geometry.instancedVerts.buffers.forEach((buffer, i) => {
            pass.setVertexBuffer(bindingOffset + i, buffer);
        });
    }

    const drawBuffer = mesh.geometry.drawBuffer;
    const instanceCount = mesh.geometry.hasInstancedAttributes ? mesh.geometry.instancedVerts.numElements : 1;

    if (mesh.geometry.nonInstancedVerts.indexBuffer) {
        pass.setIndexBuffer(mesh.geometry.nonInstancedVerts.indexBuffer, mesh.geometry.nonInstancedVerts.indexFormat);
        if (drawBuffer) {
            pass.drawIndexedIndirect(drawBuffer, 0);
        } else {
            pass.drawIndexed(mesh.geometry.nonInstancedVerts.numElements, instanceCount);
        }
    } else {
        if (drawBuffer) {
            pass.drawIndirect(drawBuffer, 0);
        } else {
            pass.draw(mesh.geometry.nonInstancedVerts.numElements, instanceCount);
        }
    }

    mesh.afterRenderCallbacks.forEach((cb) => cb && cb({ mesh, camera }));
}
