import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Make every `*.wgsl?raw` module its own HMR boundary. Without this, a .wgsl
// edit propagates up to its JS importers (e.g. `import s from './x.wgsl?raw'`)
// which don't self-accept, so Vite falls back to a full page reload. Here each
// raw module self-accepts and hands (oldCode, newCode) to the shader registry
// (see src/core/ShaderReload.js), which rebuilds the affected pipelines.
function wgslHotReload() {
    return {
        name: 'wgsl-hot-reload',
        apply: 'serve',
        transform(code, id) {
            if (!/\.wgsl\?(?:.*&)?raw\b/.test(id)) return null;
            const m = code.match(/export default (.*?);?\s*$/s);
            if (!m) return null;
            const lit = m[1];
            return {
                code: `${code}
if (import.meta.hot) {
    const __prev = ${lit};
    import.meta.hot.accept((m) => {
        globalThis.__reloadShader && globalThis.__reloadShader(__prev, m.default);
    });
}`,
                map: null,
            };
        },
    };
}

export default defineConfig(({ command }) => ({
    // Project Pages sites are served from https://<user>.github.io/<repo>/, so the
    // production build needs to be base-pathed to /ogpu/. `command` is 'build'
    // for `vite build` and 'serve' for `vite dev`/`preview`, so local dev stays
    // at '/' and only the deployed build gets the subpath.
    base: command === 'build' ? '/ogpu/' : '/',
    plugins: [wgslHotReload()],
    resolve: {
        alias: {
            '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
            '@math': fileURLToPath(new URL('./src/math', import.meta.url)),
            '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
            '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
            '@examples': fileURLToPath(new URL('./examples', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
}));
