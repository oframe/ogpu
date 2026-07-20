// Blit a fullscreen geometry (pass gpu.TRIANGLE, or gpu.QUAD for depth-reconstruction)
// through a RenderPipeline into targetView. Pass the RenderPipeline WRAPPER, not the
// raw .pipeline: blit reads .hasDynamicUniform to decide whether group(0)/binding(0)
// takes the per-draw dynamic offset ([0]) or none — passes with no uniform skip it.
// clearValue is inert — the geometry covers every pixel — so it's not exposed.
export function blit(encoder, { pipeline, geometry, targetView, bindGroup, clear = true, label } = {}) {
    const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [
            {
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: clear ? 'clear' : 'load',
                storeOp: 'store',
            },
        ],
    });
    pass.setPipeline(pipeline.pipeline);
    pass.setBindGroup(0, bindGroup, pipeline.hasDynamicUniform ? [0] : []);

    const verts = geometry.nonInstancedVerts;
    verts.buffers.forEach((buffer, i) => pass.setVertexBuffer(i, buffer));
    if (verts.indexBuffer) {
        pass.setIndexBuffer(verts.indexBuffer, verts.indexFormat);
        pass.drawIndexed(verts.numElements);
    } else {
        pass.draw(verts.numElements);
    }
    pass.end();
}
