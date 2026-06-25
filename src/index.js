// OGPU public surface — the barrel behind `import { Vec3, Mesh } from 'ogpu'`.
//
// Works via the package self-reference `exports` map in package.json. Consumers
// must be Vite (or a bundler configured with this repo's `@core/*` aliases and
// `?raw` shader loader), which is the case for any fork of this starter.
// Examples (`examples/`) are intentionally left out.

// --- core (single source of truth in ./core/index.js, the `@core` barrel) ---
export * from './core/index.js';

// --- math (Vec2/Vec3/Vec4/Quat/Mat3/Mat4/Euler) ---
export * from './math/index.js';

// --- modules ---
export { Orbit } from './modules/Orbit.js';
export { Raycast } from './modules/Raycast.js';
export { GUI } from './modules/GUI.js';
export { Animation } from './modules/Animation.js';
export { GLTFLoader } from './modules/GLTFLoader.js';
export { CubeMap } from './modules/CubeMap.js';
export { VideoTexture } from './modules/VideoTexture.js';

// --- utils ---
export { createStorageBuffer, createUniformBuffer, createBuffer } from './utils/BufferUtils.js';
export { loadJSON, loadJSONAll } from './utils/JSONLoader.js';
export { loadIBLCubeMap, loadSphericalHarmonics } from './utils/IBLUtils/IBLUtils.js';
export { TimingHelper } from './utils/TimingHelper.js';
export { applyOverrideConstants } from './utils/wgslOverrides.js';
