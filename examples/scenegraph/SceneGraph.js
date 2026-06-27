import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Transform, Box, Sphere } from 'ogpu';

import sceneGraphShader from './scenegraph.wgsl?raw';

const NUM_SHAPES = 50;

export class SceneGraph {
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
            fov: 35,
        });
        this.camera.position.set(0, 1, 7);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        // Scene root — any Transform can hold children; meshes inherit its transform.
        this.scene = new Transform();

        const sphereGeometry = new Sphere(this.gpu, { radius: 0.15 });
        const cubeGeometry = new Box(this.gpu, { size: 0.3 });

        // sphere and cube share the same attribute layout (position/normal/uv, interleaved,
        // stride 32) — declare it once and feed it to the pipeline both meshes draw with,
        // rather than borrowing one geometry's `.bufferLayouts`.
        const vertexLayout = [
            {
                arrayStride: 32,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                    { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
                    { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
                ],
            },
        ];

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'scene-graph-pipeline',
            code: sceneGraphShader,
            vertexBuffers: vertexLayout,
        });

        const makeMesh = (geometry, label) =>
            new Mesh(this.gpu, {
                label,
                pipeline,
                geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        layout: pipeline.bindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    }),
                ],
            });

        // Root sphere parented to the scene; every other shape attaches to a
        // previously created shape, building a nested hierarchy.
        const root = makeMesh(sphereGeometry, 'shape-0');
        root.speed = -0.5;
        root.setParent(this.scene);

        this.shapes = [root];

        for (let i = 0; i < NUM_SHAPES; i++) {
            const useCube = Math.random() > 0.5;
            const shape = makeMesh(useCube ? cubeGeometry : sphereGeometry, `shape-${i + 1}`);
            // Uniform scale: set all three components. Non-uniform scale in a
            // parented node shears children once the parent rotates.
            const s = Math.random() * 0.3 + 0.7;
            shape.scale.set(s, s, s);
            shape.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
            shape.speed = (Math.random() - 0.5) * 0.7;

            // Attach to a random, already-created shape so transforms nest.
            shape.setParent(this.shapes[Math.floor(Math.random() * this.shapes.length)]);
            this.shapes.push(shape);
        }

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.gpu.renderer.add(this.update);
    }

    update = () => {
        for (const shape of this.shapes) {
            shape.rotation.y += 0.03 * shape.speed;
            shape.rotation.x += 0.04 * shape.speed;
            shape.rotation.z += 0.01 * shape.speed;
        }

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
