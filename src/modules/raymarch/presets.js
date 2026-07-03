// Raymarcher scene presets: materials + initial primitives + per-frame animate.
// `build(rm)` runs once on setPreset; `animate(rm, { time, morph })` runs every
// frame from the raymarcher's onBeforeRender — morphing is just JS rewriting
// blendK/params/transforms into the primitive buffer.

import { Quat } from '@math';

const _q = /* @__PURE__ */ new Quat();

export const PRESETS = {
    metaballs: {
        materials: [
            { color: [0.9, 0.35, 0.15], roughness: 0.25, metallic: 0.0 },
            { color: [0.2, 0.5, 0.9], roughness: 0.15, metallic: 0.4 },
        ],
        build(rm) {
            this.animate(rm, { time: 0, morph: rm.morph });
        },
        animate(rm, { time, morph }) {
            // morph drives the smooth-min radius: 0 = separate spheres, 1 = one blob
            const k = 0.12 + morph * 0.9;
            for (let i = 0; i < 6; i++) {
                const a = time * (0.5 + i * 0.13) + i * 2.4;
                const b = time * (0.34 + i * 0.09) + i * 1.7;
                rm.setPrimitive(i, {
                    kind: 'sphere',
                    position: [Math.sin(a) * 1.3, 1.2 + Math.sin(b) * 0.75, Math.cos(a * 0.8) * 1.3],
                    params: [0.42 + 0.14 * Math.sin(time * 0.7 + i)],
                    blendK: k,
                    materialId: i % 2,
                });
            }
        },
    },

    'morphing-blob': {
        materials: [
            { color: [0.85, 0.7, 0.3], roughness: 0.2, metallic: 0.6 },
            { color: [0.25, 0.6, 0.5], roughness: 0.35, metallic: 0.0 },
        ],
        build(rm) {
            this.animate(rm, { time: 0, morph: rm.morph });
        },
        animate(rm, { time, morph }) {
            // co-located sphere/box swap dominance with morph; a torus orbits through
            const s = 1 - morph;
            rm.setPrimitive(0, {
                kind: 'sphere',
                position: [0, 1.2, 0],
                params: [0.35 + 0.85 * s],
                blendK: 0.5,
            });
            _q.fromEuler(0, time * 0.6, time * 0.3);
            rm.setPrimitive(1, {
                kind: 'box',
                position: [0, 1.2, 0],
                rotation: _q,
                params: [0.2 + 0.7 * morph, 0.2 + 0.7 * morph, 0.2 + 0.7 * morph, 0.06],
                blendK: 0.5,
            });
            _q.fromEuler(time * 0.4, 0, Math.PI / 2.5);
            rm.setPrimitive(2, {
                kind: 'torus',
                position: [Math.sin(time * 0.5) * 0.8, 1.2, Math.cos(time * 0.5) * 0.8],
                rotation: _q,
                params: [1.15, 0.14 + 0.1 * morph],
                blendK: 0.25 + 0.5 * morph,
                materialId: 1,
            });
        },
    },

    'mirror-sphere-garden': {
        materials: [
            { color: [0.5, 0.5, 0.55], roughness: 0.55, metallic: 0.0 }, // ground
            { color: [0.95, 0.95, 0.95], roughness: 0.06, metallic: 1.0, reflectivity: 1.0 }, // mirror
            { color: [0.75, 0.2, 0.25], roughness: 0.3, metallic: 0.0 }, // accent
        ],
        build(rm) {
            this.animate(rm, { time: 0, morph: rm.morph });
        },
        animate(rm, { time, morph }) {
            // ground sits just below any raster floor; morph melts the spheres into it
            const k = 0.05 + morph * 0.7;
            rm.setPrimitive(0, { kind: 'plane', position: [0, -0.02, 0], materialId: 0 });
            rm.setPrimitive(1, {
                kind: 'sphere',
                position: [-1.5, 0.9 + Math.sin(time * 0.8) * 0.15, -0.6],
                params: [0.85],
                blendK: k,
                materialId: 1,
            });
            rm.setPrimitive(2, {
                kind: 'sphere',
                position: [1.4, 0.65 + Math.sin(time * 0.6 + 2) * 0.12, 0.9],
                params: [0.6],
                blendK: k,
                materialId: 1,
            });
            rm.setPrimitive(3, {
                kind: 'sphere',
                position: [0.4, 0.4 + Math.sin(time * 0.7 + 4) * 0.08, -1.7],
                params: [0.38],
                blendK: k,
                materialId: 1,
            });
            _q.fromEuler(0, time * 0.25, 0);
            rm.setPrimitive(4, {
                kind: 'box',
                position: [2.1, 0.45, -1.5],
                rotation: _q,
                params: [0.42, 0.42, 0.42, 0.06],
                blendK: 0.15,
                materialId: 2,
            });
            rm.setPrimitive(5, {
                kind: 'capsule',
                position: [-1.7, 0.78, 1.6],
                params: [0.45, 0.28],
                blendK: 0.15,
                materialId: 2,
            });
        },
    },
};
