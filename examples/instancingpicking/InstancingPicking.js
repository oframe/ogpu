import { Camera, Renderer, Orbit, Raycast, RenderPipeline, Mesh, Transform, Box, ComputeShader, createStorageBuffer, createUniformBuffer } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

import picking from './picking.wgsl?raw';
import instances from './instances.wgsl?raw';

const NUM = 20;
const BOX_SIZE = 0.2;

export class InstancingPicking {
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
            fov: 15,
        });
        this.camera.position.set(0, 0, 15);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();
        this.raycast = new Raycast();
        this.ndc = [-2, -2]; // offscreen until the mouse moves

        // Per-instance data, padded to vec4 so one array feeds both the
        // instanced vertex buffer and the compute storage buffer (vec4 stride).
        const offset = new Float32Array(NUM * 4);
        const random = new Float32Array(NUM * 4);
        for (let i = 0; i < NUM; i++) {
            offset.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 4);
            random.set([Math.random(), Math.random(), Math.random()], i * 4);
        }

        const geometry = new Box(this.gpu, {
            size: BOX_SIZE,
            instancedData: {
                offset: { data: offset, numComponents: 4 },
                random: { data: random, numComponents: 4 },
            },
        });

        // Storage buffers: offset/random as compute inputs, hits as output.
        this.offsetBuffer = createStorageBuffer(this.gpu, { label: 'offset-data', size: offset.byteLength });
        this.randomBuffer = createStorageBuffer(this.gpu, { label: 'random-data', size: random.byteLength });
        this.hitsBuffer = createStorageBuffer(this.gpu, { label: 'hit-data', size: NUM * 4 });
        this.gpu.device.queue.writeBuffer(this.offsetBuffer, 0, offset);
        this.gpu.device.queue.writeBuffer(this.randomBuffer, 0, random);

        // Compute: the picking kernel.
        this.compute = new ComputeShader(this.gpu, { label: 'picking-compute', code: picking });
        this.pickKernel = this.compute.findKernel('pick');
        this.threadGroups = Math.ceil(NUM / 64);

        this.pickUniforms = makeStructuredView(this.compute.defs.uniforms.uniforms);
        this.pickUniformBuffer = createUniformBuffer(this.gpu, {
            label: 'pick-uniforms',
            size: this.pickUniforms.arrayBuffer.byteLength,
        });

        this.pickBindGroup = this.gpu.device.createBindGroup({
            label: 'pick-bind-group',
            layout: this.compute.bindGroupLayout(this.pickKernel),
            entries: [
                { binding: 0, resource: { buffer: this.pickUniformBuffer } },
                { binding: 1, resource: { buffer: this.offsetBuffer } },
                { binding: 2, resource: { buffer: this.randomBuffer } },
                { binding: 3, resource: { buffer: this.hitsBuffer } },
            ],
        });

        // Render: instanced cubes, coloured by the hits buffer.
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'instancing-picking-pipeline',
            code: instances,
            vertexBuffers: geometry.bufferLayouts,
        });

        this.cubes = new Mesh(this.gpu, {
            label: 'cubes',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: { buffer: this.hitsBuffer } },
                    ],
                }),
            ],
        });
        this.scene.addChild(this.cubes);

        addEventListener('mousemove', this.handleMove);
        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.gpu.renderer.add(this.update);
    }

    handleMove = (e) => {
        const w = this.renderer.canvas.clientWidth;
        const h = this.renderer.canvas.clientHeight;
        this.ndc = [(2.0 * e.clientX) / w - 1.0, 2.0 * (1.0 - e.clientY / h) - 1.0];
    };

    update = () => {
        // Recast every frame so orbiting the camera updates the pick too.
        this.raycast.castMouse(this.camera, this.ndc);
        const o = this.raycast.origin;
        const d = this.raycast.direction;
        this.pickUniforms.set({
            rayOrigin: [o.x, o.y, o.z],
            rayDir: [d.x, d.y, d.z],
            halfSize: BOX_SIZE / 2,
        });
        this.gpu.device.queue.writeBuffer(this.pickUniformBuffer, 0, this.pickUniforms.arrayBuffer);

        const encoder = this.gpu.device.createCommandEncoder({ label: 'pick-encoder' });
        const pass = encoder.beginComputePass({ label: 'pick-pass' });
        this.compute.dispatch(encoder, {
            pass,
            kernel: this.pickKernel,
            bindGroup: this.pickBindGroup,
            dispatchCount: [this.threadGroups, 1, 1],
        });
        pass.end();
        this.gpu.device.queue.submit([encoder.finish()]);

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
