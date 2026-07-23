import { Camera, Renderer, RenderPipeline, Mesh, Box, Sphere, Torus, Cylinder, Cone, Disc, Plane } from 'ogpu';

// normal-shaded vs/fs, no textures — fine for every primitive here
import primitiveShader from '@examples/primitives/primitives.wgsl?raw';

import './multicanvas.css';

// One device, one loop, eight canvases in a scrollable 2x2 grid: each frame
// binds a cell with renderer.setContext(canvas) and draws that cell's primitive
// from that cell's camera, all into a single command encoder. Cells are sized by
// CSS; a ResizeObserver copies the laid-out box into the canvas backing store
// (the renderer only observes its own canvas), and the engine remakes that
// canvas's depth texture on mismatch.
const CELLS = [
    { label: 'box', geometry: (gpu) => new Box(gpu) },
    { label: 'sphere', geometry: (gpu) => new Sphere(gpu, { subdivisionsAxis: 32 }) },
    { label: 'torus', geometry: (gpu) => new Torus(gpu, { radius: 0.7, thickness: 0.3 }) },
    { label: 'cylinder', geometry: (gpu) => new Cylinder(gpu, { radius: 0.7, height: 1.4 }) },
    { label: 'cone', geometry: (gpu) => new Cone(gpu, { bottomRadius: 0.8, height: 1.6 }) },
    { label: 'disc', geometry: (gpu) => new Disc(gpu), cullMode: 'none' },
    { label: 'ring', geometry: (gpu) => new Disc(gpu, { innerRadius: 0.55 }), cullMode: 'none' },
    { label: 'plane', geometry: (gpu) => new Plane(gpu, { width: 1.6, depth: 1.6 }), cullMode: 'none' },
];

export class MultiCanvas {
    constructor() {
        this.cells = [];
        this.byCanvas = new Map();
        this.init();
    }

    async init() {
        // The page canvas becomes the first cell, so the renderer's own canvas is
        // just another tile. setContext no-ops when it's already bound, which is
        // why the draw loop below needs no special case for it.
        this.pageCanvas = document.getElementById('web-gpu-canvas');

        this.grid = document.createElement('div');
        this.grid.className = 'mc-grid';
        document.body.appendChild(this.grid);

        this.renderer = new Renderer({ canvas: this.pageCanvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        // backing store follows the CSS-laid-out box (the renderer observes cell 0
        // itself — same values written twice, no conflict)
        this.resizeObserver = new ResizeObserver(this.handleResize);
        // don't draw cells scrolled out of view
        this.intersectionObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    this.byCanvas.get(entry.target).visible = entry.isIntersecting;
                }
            },
            { root: this.grid }
        );

        this.cells = CELLS.map((config, i) => this.addCell(config, i === 0 ? this.pageCanvas : document.createElement('canvas')));

        this.renderer.add(this.update);
    }

    addCell({ label, geometry: makeGeometry, cullMode = 'back' }, canvas) {
        canvas.classList.add('mc-canvas');
        this.grid.appendChild(canvas);

        const geometry = makeGeometry(this.gpu);
        const pipeline = new RenderPipeline(this.gpu, {
            label: `${label}-pipeline`,
            code: primitiveShader,
            vertexBuffers: geometry.bufferLayouts,
            cullMode,
        });

        const mesh = new Mesh(this.gpu, {
            label: `${label}-mesh`,
            pipeline,
            geometry,
            bindGroups: (uniformResource) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: uniformResource }],
                }),
            ],
        });

        const camera = new Camera({ aspect: 1, fov: 45 });
        camera.position.set(0, 1.4, 3.4);
        camera.lookAt([0, 0, 0]);

        const cell = { label, canvas, camera, mesh, visible: true };
        this.byCanvas.set(canvas, cell);
        this.resizeObserver.observe(canvas);
        this.intersectionObserver.observe(canvas);

        return cell;
    }

    handleResize = (entries) => {
        const { maxTextureDimension2D } = this.gpu.device.limits;

        for (const entry of entries) {
            const cell = this.byCanvas.get(entry.target);
            const width = entry.devicePixelContentBoxSize?.[0].inlineSize || entry.contentBoxSize[0].inlineSize * this.renderer.dpr;
            const height = entry.devicePixelContentBoxSize?.[0].blockSize || entry.contentBoxSize[0].blockSize * this.renderer.dpr;

            entry.target.width = Math.max(1, Math.min(width, maxTextureDimension2D));
            entry.target.height = Math.max(1, Math.min(height, maxTextureDimension2D));

            cell.camera.aspect = entry.target.width / entry.target.height;
            cell.camera.updateProjectionMatrix();
        }
    };

    update = () => {
        const dt = this.renderer.deltaTime;

        // One encoder for the whole grid: render() skips finish/submit when it's
        // handed an encoder, so eight cells cost one submit instead of eight.
        const encoder = this.gpu.device.createCommandEncoder({ label: 'multicanvas-encoder' });

        this.cells.forEach((cell, i) => {
            if (!cell.visible) return;

            cell.mesh.rotateX(dt * 0.35);
            cell.mesh.rotateY(dt * (0.5 + i * 0.12));

            this.renderer.setContext(cell.canvas);
            this.renderer.render({ scene: cell.mesh, camera: cell.camera, encoder });
        });

        this.gpu.device.queue.submit([encoder.finish()]);
    };
}
