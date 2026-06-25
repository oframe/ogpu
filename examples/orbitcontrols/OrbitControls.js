import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Geometry, Texture, loadJSON } from 'ogpu';

import orbitShader from './orbit.wgsl?raw';

export class OrbitControls {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(-2, 1, 2);

        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [0, 0.7, 0] });
        this.addCredit();

        this.scene = new Transform();

        const data = await loadJSON('./assets/orbitcontrols/macaw.json');
        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                normal: { data: data.normal, numComponents: 3, type: Float32Array },
                uv: { data: data.uv, numComponents: 2, type: Float32Array },
            },
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'orbit-macaw-pipeline',
            code: orbitShader,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
        });

        const sampler = this.gpu.device.createSampler();
        const texture = new Texture(this.gpu, { src: './assets/orbitcontrols/macaw.jpg' });
        await texture.ready;
        const view = texture.createView();

        this.macaw = new Mesh(this.gpu, {
            label: 'macaw',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: sampler },
                        { binding: 2, resource: view },
                    ],
                }),
            ],
        });
        this.scene.addChild(this.macaw);

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    // Top-left credit + zoom-style dropdown (dolly/fov), mirroring the
    // original example. Styling lives in examples.css (.Info / #dropdown).
    addCredit() {
        const info = document.createElement('div');
        info.className = 'Info';
        info.innerHTML = `
            Orbit Controls. Model by Google Poly.
            <div id="dropdown">
                <label for="zoom-style">Zoom Style:</label>
                <select name="zoom-style" id="zoom-style">
                    <option value="dolly">Dolly</option>
                    <option value="fov">FOV</option>
                </select>
            </div>`;
        info.querySelector('#zoom-style').addEventListener('change', (e) => {
            this.orbit.zoomStyle = e.target.value;
        });
        document.body.appendChild(info);
        this.credit = info;
    }

    update = () => {
        requestAnimationFrame(this.update);
        this.orbit.update();
        // fov-zoom mutates camera.fov; rebuild projection so it takes effect.
        if (this.orbit.zoomStyle === 'fov') this.camera.updateProjectionMatrix();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
