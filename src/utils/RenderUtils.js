// Blit a buffer-less fullscreen quad (triangle-strip, draw(4)) into targetView.
// group(0)/binding(0) uniforms are dynamic engine-wide, hence the [0] offset.
// clearValue is inert — the quad covers every pixel — so it's not exposed.
export function blit(encoder, { pipeline, targetView, bindGroup, clear = true, label } = {}) {
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
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup, [0]);
    pass.draw(4);
    pass.end();
}
