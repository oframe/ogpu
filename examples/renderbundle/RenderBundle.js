import { Camera, Renderer, Orbit, GUI, Shader, UniformBuffer, Mesh, Transform, RenderBundleGroup, Box, Sphere } from 'ogpu';

import renderBundleShader from './renderbundle.wgsl?raw';

const GRID = 80; // GRID² static meshes
const MOVERS = 8; // moving meshes inside the recorded group
const LIVE = 8; // moving meshes outside it, drawn live
const WINDOW = 60; // frames in the render() timing window

const COLORS = [
    [0.85, 0.42, 0.3, 1],
    [0.3, 0.6, 0.85, 1],
    [0.45, 0.8, 0.45, 1],
    [0.9, 0.8, 0.35, 1],
];

// A large static field drawn from a RenderBundleGroup's bundle vs the same meshes
// drawn live. Moving children stay valid inside the group (only their engine
// slots change); a state swap makes it stale until re-recorded.
export class RenderBundle {
    constructor() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2, perDrawSize: (GRID * GRID + MOVERS + LIVE + 2) * 256 });
        this.init();
    }

    async init() {
        await this.renderer.ready;
        const gpu = (this.gpu = this.renderer.gpu);

        this.camera = new Camera({ aspect: gpu.canvas.width / gpu.canvas.height, fov: 45 });
        this.camera.position.set(0, 18, 34);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: gpu.canvas });

        this.scene = new Transform();
        this.recorded = new RenderBundleGroup({ label: 'render-bundle-field' });
        this.plain = new Transform();
        this.recorded.setParent(this.scene);
        this.plain.setParent(this.scene);

        const shader = new Shader(gpu, { label: 'render-bundle-shader', code: renderBundleShader });
        this.materials = COLORS.map((color) =>
            shader.bindGroupLayout(0).createBindGroup({
                uniforms: new UniformBuffer(gpu, shader.uniforms, { color }),
            })
        );
        const geometries = [new Box(gpu), new Sphere(gpu)];
        this.solid = {};
        this.inside = { cullMode: 'front' };

        // the field: GRID² meshes, 2 geometries × 4 materials
        this.field = [];
        const half = (GRID - 1) / 2;
        for (let i = 0; i < GRID * GRID; i++) {
            const x = (i % GRID) - half;
            const z = Math.floor(i / GRID) - half;
            const h = 0.3 + 1.7 * (0.5 + 0.5 * Math.sin(x * 0.31) * Math.cos(z * 0.27));
            const mesh = new Mesh({
                label: 'field-mesh',
                geometry: geometries[(i >> 3) & 1],
                shader,
                state: this.solid,
                bindGroups: [this.materials[i & 3]],
            });
            mesh.position.set(x * 0.5, h * 0.25, z * 0.5);
            mesh.scale.set(0.35, h * 0.5, 0.35);
            this.field.push(mesh);
        }

        this.movers = [];
        for (let i = 0; i < MOVERS; i++) {
            const mesh = new Mesh({
                label: 'recorded-mover',
                geometry: geometries[0],
                shader,
                state: this.solid,
                bindGroups: [this.materials[(i + 1) & 3]],
            });
            mesh.scale.set(0.8, 0.8, 0.8);
            this.movers.push(mesh);
        }

        this.live = [];
        for (let i = 0; i < LIVE; i++) {
            const mesh = new Mesh({
                label: 'live-mover',
                geometry: geometries[1],
                shader,
                state: this.solid,
                bindGroups: [this.materials[i & 3]],
            });
            mesh.scale.set(0.7, 0.7, 0.7);
            mesh.setParent(this.scene);
            this.live.push(mesh);
        }

        // ?mode=live starts with live draws (handy for A/B benchmarks)
        const live = new URLSearchParams(location.search).get('mode') === 'live';
        const mode = live ? 'live' : 'recorded';
        this.params = { mode, animate: true, stale: false, renderMs: 0, renderBestMs: 0 };
        this._times = [];
        this._tick = 0;
        this.setMode(mode);

        this.gui = new GUI({ title: 'render bundle' });
        this.gui
            .add(this.params, 'mode', {
                label: 'mode',
                options: { recorded: 'recorded', live: 'live' },
            })
            .on('change', ({ value }) => this.setMode(value));
        this.gui.add(this.params, 'animate', { label: 'animate' });
        this.gui.button('re-record', () => this.recorded.record());
        // a state swap on a recorded child: stale until re-recorded
        this.gui.button('swap-mover-state', () => {
            const m = this.movers[0];
            m.state = m.state === this.solid ? this.inside : this.solid;
        });
        this.gui.monitor(this.params, 'stale', { label: 'stale' });
        this.gui.monitor(this.params, 'renderMs', {
            label: 'render-ms',
            format: (v) => v.toFixed(3),
        });
        this.gui.monitor(this.params, 'renderBestMs', {
            label: 'render-best-ms',
            format: (v) => v.toFixed(3),
        });

        addEventListener('resize', this.handleResize);
        this.handleResize();
        this.renderer.add(this.update);
    }

    // Recorded: the field and the movers live under the RenderBundleGroup and are
    // recorded once (the explicit moment). Live: the same meshes under a plain
    // Transform, drawn one by one.
    setMode(mode) {
        const parent = mode === 'recorded' ? this.recorded : this.plain;
        for (const m of this.field) m.setParent(parent);
        for (const m of this.movers) m.setParent(parent);
        // an emptied group still holds its last recording: hide it, or it replays
        this.recorded.visible = mode === 'recorded';
        if (mode === 'recorded') this.recorded.record();
        this._times.length = 0;
    }

    update = ({ time }) => {
        if (this.params.animate) {
            for (let i = 0; i < this.movers.length; i++) {
                const a = time * 0.6 + (i / this.movers.length) * Math.PI * 2;
                this.movers[i].position.set(Math.cos(a) * 12, 2.5 + Math.sin(a * 2), Math.sin(a) * 12);
                this.movers[i].rotation.y = a;
            }
            for (let i = 0; i < this.live.length; i++) {
                const a = -time * 0.4 + (i / this.live.length) * Math.PI * 2;
                this.live[i].position.set(Math.cos(a) * 7, 4 + Math.sin(time + i), Math.sin(a) * 7);
            }
        }

        const t0 = performance.now();
        this.renderer.render({ scene: this.scene, camera: this.camera });
        const ms = performance.now() - t0;

        const times = this._times;
        times.push(ms);
        if (times.length > WINDOW) times.shift();
        this.params.renderMs = times.reduce((s, v) => s + v, 0) / times.length;
        this.params.renderBestMs = Math.min(...times);
        // stale walks the whole recording: sample it, don't pay for it every frame
        if (++this._tick % 30 === 0) {
            this.params.stale = this.params.mode === 'recorded' && this.recorded.stale;
        }
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
