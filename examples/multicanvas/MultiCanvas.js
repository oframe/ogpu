import { Camera, Renderer, RenderPipeline, Mesh, Vec3, Box, Sphere, Torus, Cylinder, Cone, Disc, Plane } from 'ogpu';

// normal-shaded vs/fs, no textures — fine for every primitive here
import primitiveShader from '@examples/primitives/primitives.wgsl?raw';

import './multicanvas.css';

// One device, one loop, eight canvases in a scrollable 2x2 grid: each frame
// binds a cell with renderer.setContext(canvas) and draws that cell's primitive
// from that cell's camera, all into a single command encoder. Cells are sized by
// CSS; a ResizeObserver copies the laid-out box into the canvas backing store
// (the renderer only observes its own canvas), and the engine remakes that
// canvas's depth texture on mismatch.
// eye position for a landscape cell; handleResize dollies it out for portrait ones
const EYE = /* @__PURE__ */ new Vec3(0, 1.4, 3.4);

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
        camera.position.copy(EYE);
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

            // devicePixelContentBoxSize is the honest one; contentBoxSize × dpr is the
            // fallback, and contentRect covers Safari versions that ship neither array.
            const devicePixels = entry.devicePixelContentBoxSize?.[0];
            const cssBox = entry.contentBoxSize?.[0];
            const width = devicePixels?.inlineSize ?? (cssBox?.inlineSize ?? entry.contentRect.width) * this.renderer.dpr;
            const height = devicePixels?.blockSize ?? (cssBox?.blockSize ?? entry.contentRect.height) * this.renderer.dpr;

            entry.target.width = Math.max(1, Math.min(width, maxTextureDimension2D));
            entry.target.height = Math.max(1, Math.min(height, maxTextureDimension2D));

            const aspect = entry.target.width / entry.target.height;

            // fov is vertical, so a portrait cell narrows the horizontal view and clips
            // the primitive sideways — back the eye off by the same factor to keep every
            // cell framed the same, phone or desktop.
            cell.camera.position.copy(EYE).scale(1 / Math.min(1, aspect));

            cell.camera.aspect = aspect;
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
