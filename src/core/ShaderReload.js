// Shader hot-reload registry.
//
// RenderPipeline / ComputeShader register themselves here on construction so a
// .wgsl edit can rebuild them in place instead of reloading the page.
//
// The actual HMR wiring lives in the `wgsl-hot-reload` Vite plugin
// (vite.config.js): it makes every `*.wgsl?raw` module a self-accepting HMR
// boundary that calls globalThis.__reloadShader(oldCode, newCode) on change.
// That avoids a full page reload no matter how many JS files import the shader
// directly (a single glob-based boundary here can't, since the direct
// `import x from './x.wgsl?raw'` importers don't self-accept).
//
// Everything is gated on import.meta.hot, statically undefined in a production
// build — so the registry and the global dead-code-eliminate to nothing.
//
// The registry lives on globalThis so it survives this module being
// re-executed by HMR; the pipeline instances are owned by the example.

const noop = () => {};

export function registerShader(instance) {
    if (!import.meta.hot) return noop;
    const registry = (globalThis.__shaderRegistry ??= new Set());
    registry.add(instance);
    return () => registry.delete(instance);
}

if (import.meta.hot) {
    globalThis.__shaderRegistry ??= new Set();

    // Called by each self-accepting .wgsl?raw module (via the Vite plugin) with
    // the shader's previous and new source. Match registered pipelines by their
    // stored raw `code` and reload them.
    globalThis.__reloadShader = (oldCode, newCode) => {
        if (oldCode === newCode) return;
        let count = 0;
        for (const inst of globalThis.__shaderRegistry) {
            if (inst.code === oldCode && typeof inst.reload === 'function') {
                inst.reload(newCode);
                count++;
            }
        }
        console.log(`[hot] shader changed — reloaded ${count} pipeline(s)`);
    };
}
