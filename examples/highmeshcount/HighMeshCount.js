import { Camera, Renderer, Shader, Mesh, Transform, Box, RenderBundleGroup } from 'ogpu';
import { GUI } from '@modules/GUI';

import highMeshCountShader from './highmeshcount.wgsl?raw';

// One shader, one shared box geometry, no per-mesh resources — engine uniforms only.
// Stress test for high draw-call counts; mesh count is live-tunable. `mode`
// (`?mode=recorded`) puts the meshes in a RenderBundleGroup: one render bundle replays
// them, so render() skips the per-mesh draw encoding — but the group isn't
// frustum culled, so every mesh is drawn.
export class HighMeshCount {
    count = 1000;
    mode = new URLSearchParams(location.search).get('mode') === 'recorded' ? 'recorded' : 'live';
    animate = true;

    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        // starting size of the engine buffer (it doubles when full): one 256 B slot per
        // mesh at the gui max count + the time slot + the pass's camera slot, so it never has to grow
        this.renderer = new Renderer({ canvas, dpr: 2, perDrawSize: (50000 + 2) * 256 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 35,
            far: 3000,
        });

        this.scene = new Transform();
        this.group = new RenderBundleGroup({ label: 'high-mesh-count-group' });
        this.group.setParent(this.scene);
        // the meshes live under one holder, so switching mode reparents one node
        this.holder = new Transform();
        this.geometry = new Box(this.gpu);

        this.shader = new Shader(this.gpu, { label: 'high-mesh-count-shader', code: highMeshCountShader });

        this.meshes = [];
        this.setMeshCount(this.count);

        const gui = new GUI({ title: 'high-mesh-count' });
        gui.add(this, 'count', { min: 1, max: 50000, step: 1, label: 'mesh-count' });
        gui.button('set-mesh-count', () => this.setMeshCount(this.count));
        gui.add(this, 'mode', { options: { live: 'live', recorded: 'recorded' } }).on('change', (e) => this.setMode(e.value));
        gui.add(this, 'animate');

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.gpu.renderer.add(this.update);
    }

    setMeshCount(count) {
        count = parseInt(count) || 1000;

        for (const mesh of this.meshes) mesh.destroy(); // frees its engine slot
        this.meshes = [];
        this.holder.setParent(null);
        this.holder = new Transform();

        for (let i = 0; i < count; i++) {
            const mesh = new Mesh({
                label: `mesh-${i}`,
                geometry: this.geometry,
                shader: this.shader,
            });

            mesh.position.set(-100 + Math.random() * 200, -100 + Math.random() * 200, -100 + Math.random() * 200);
            mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            mesh.setParent(this.holder);
            this.meshes.push(mesh);
        }

        this.count = count;
        this.setMode(this.mode);
    }

    setMode(mode) {
        this.mode = mode;
        this.holder.setParent(mode === 'recorded' ? this.group : this.scene);
        this.group.visible = mode === 'recorded';
        // the recording is explicit: capture the new children (or none, in live mode)
        this.group.record();
    }

    update = () => {
        const time = performance.now() / 30000;
        this.camera.position.set(Math.sin(time) * 180, 80, Math.cos(time) * 180);
        this.camera.lookAt([0, 0, 0]);

        if (this.animate) {
            for (const mesh of this.meshes) {
                mesh.rotation.x += 0.01;
                mesh.rotation.y += 0.01;
            }
        }

        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
