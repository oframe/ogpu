import { Camera, Renderer, Transform, Orbit, GUI, PerformanceProfile } from 'ogpu';
import { ParticleSystem } from '@modules/particles/ParticleSystem.js';

// GPU-resident particle system demo: emit/simulate/compact on the GPU with
// indirect draw/dispatch. Preset dropdown covers curl-noise fields, snow,
// fountain, embers, an immortal field and a boids flock.
export class ParticleSystemExample {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(0, 1, 7);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();
        this.renderer.setClearColor({ r: 0.015, g: 0.015, b: 0.02 });

        this.particles = new ParticleSystem(this.gpu, {
            capacity: 100_000,
            preset: 'flying',
        });
        this.scene.addChild(this.particles);

        this.gui = new GUI({ title: 'particle-system', expanded: true });
        this.particles.addGUI(this.gui);

        // fixed capacity; quality tier only scales the emission rate
        this.profile = await PerformanceProfile.detect(this.gpu);
        this.particles.setQuality(this.profile.quality);
        this.profile.onQualityChange((q) => this.particles.setQuality(q));
        this.profile.addGUI(this.gui);

        this.renderer.addResizeHandler(this.handleResize);
        this.handleResize();

        this.renderer.add(this.update);
    }

    update = ({ deltaTime }) => {
        this.particles.update(null, { dt: Math.min(deltaTime, 0.05) });
        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        if (!this.renderer.canvas.height) return;
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
