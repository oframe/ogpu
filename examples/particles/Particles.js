import { Camera, Renderer, Transform, Orbit, createStorageBuffer, ComputeShader, createUniformBuffer, Geometry, RenderPipeline, Mesh, Quad, GUI } from 'ogpu';

import sim from './sim.wgsl?raw';
import particles from './particles.wgsl?raw';
import { makeStructuredView } from 'webgpu-utils';

export class Particles {
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
        this.camera.position.set(0, 0, 6);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        let PARTICLE_COUNT = 100000;
        this.threadCount = 64;
        this.threadGroupCount = Math.ceil(PARTICLE_COUNT / this.threadCount);
        PARTICLE_COUNT = this.threadGroupCount * this.threadCount;

        const velocityData = new Float32Array(PARTICLE_COUNT * 4);
        const positionData = new Float32Array(PARTICLE_COUNT * 4);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            positionData[i * 4] = 2.0 * Math.random() - 1.0;
            positionData[i * 4 + 1] = 2.0 * Math.random() - 1.0;
            positionData[i * 4 + 2] = 2.0 * Math.random() - 1.0;
            positionData[i * 4 + 3] = Math.random();
        }

        this.velocityBuffer = createStorageBuffer(this.gpu, {
            label: 'velocity-data',
            size: velocityData.byteLength,
        });

        this.gpu.device.queue.writeBuffer(this.velocityBuffer, 0, velocityData);

        this.positionBufferRead = createStorageBuffer(this.gpu, {
            label: 'position-data-read',
            size: positionData.byteLength,
        });

        this.gpu.device.queue.writeBuffer(this.positionBufferRead, 0, positionData);

        this.positionBufferWrite = createStorageBuffer(this.gpu, {
            label: 'position-data-write',
            size: positionData.byteLength,
        });

        this.gpu.device.queue.writeBuffer(this.positionBufferWrite, 0, positionData);

        this.computeShader = new ComputeShader(this.gpu, {
            label: 'compute-shader-example',
            code: sim,
        });

        this.simUniforms = makeStructuredView(this.computeShader.defs.uniforms.uniforms);

        this.simUniforms.set({
            time: 0,
            uDt: 0,
        });

        this.simUniformBuffer = createUniformBuffer(this.gpu, {
            label: 'sim-uniform-buffer',
            size: this.simUniforms.arrayBuffer.byteLength,
        });

        this.gpu.device.queue.writeBuffer(this.simUniformBuffer, 0, this.simUniforms.arrayBuffer);

        this.velocityUniforms = makeStructuredView(this.computeShader.defs.uniforms.velocityUniforms);

        this.velocityUniforms.set({
            uSpatialFreq: 0.443,
            uTemporalFreq: 0.15,
            uAmp: 0.5,
            uIntertia: 1.3,
            uConstraintRadius: 1.0,
        });

        this.velocityUniformBuffer = createUniformBuffer(this.gpu, {
            label: 'velocity-uniform-buffer',
            size: this.velocityUniforms.arrayBuffer.byteLength,
        });

        this.gpu.device.queue.writeBuffer(this.velocityUniformBuffer, 0, this.velocityUniforms.arrayBuffer);

        // noise params live in velocityUniforms; GUI edits push through to the GPU buffer
        const noiseTarget = {
            uniforms: this.velocityUniforms,
            uniformBuffer: this.velocityUniformBuffer,
            gpu: this.gpu,
        };
        this.gui = new GUI({ title: 'particles' });
        const noise = this.gui.folder('noise');
        noise.uniform(noiseTarget, 'uSpatialFreq', { label: 'spatialFreq', min: 0, max: 2, step: 0.001 });
        noise.uniform(noiseTarget, 'uTemporalFreq', { label: 'temporalFreq', min: 0, max: 1, step: 0.001 });
        noise.uniform(noiseTarget, 'uAmp', { label: 'amp', min: 0, max: 2, step: 0.001 });
        noise.uniform(noiseTarget, 'uIntertia', { label: 'intertia', min: 0, max: 5, step: 0.001 });
        noise.uniform(noiseTarget, 'uConstraintRadius', { label: 'constraintRadius', min: 0, max: 3, step: 0.001 });

        /**
         * this example is intentionally verbose to demonstrate how to ping-pong
         * buffers in WebGPU. here we are ping-ponging the positions and keeping
         * velocity as read_write.
         *
         * we prebuild two bind groups (read A/write B, read B/write A) against the
         * kernel's layout (computeShader.bindGroupLayout(kernel)) and swap by index
         * each frame — the caller owns the bind groups; ComputeShader only serves
         * the layout.
         */

        const simEntries = (readBuffer, writeBuffer) => [
            { binding: 0, resource: { buffer: this.simUniformBuffer } },
            { binding: 1, resource: { buffer: this.velocityUniformBuffer } },
            { binding: 2, resource: { buffer: this.velocityBuffer } },
            { binding: 3, resource: { buffer: readBuffer } },
            { binding: 4, resource: { buffer: writeBuffer } },
        ];

        // state 0: read A / write B. state 1: read B / write A. swap each frame.
        const pingPong = [
            [this.positionBufferRead, this.positionBufferWrite],
            [this.positionBufferWrite, this.positionBufferRead],
        ];

        const simKernel = this.computeShader.findKernel('simulate');

        this.simBindGroups = pingPong.map(([read, write], i) =>
            this.gpu.device.createBindGroup({
                label: `sim-bind-group-${i}`,
                layout: this.computeShader.bindGroupLayout(simKernel),
                entries: simEntries(read, write),
            })
        );

        this.t = 0;

        const baseGeometry = new Quad(this.gpu, { size: 2 });
        const data = new Float32Array(PARTICLE_COUNT * 4);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            data[i * 4] = Math.random();
            data[i * 4 + 1] = Math.random();
            data[i * 4 + 2] = Math.random();
            data[i * 4 + 3] = Math.random();
        }

        const geometry = new Geometry(this.gpu, {
            data: baseGeometry.attributes,
            instancedData: {
                dataData: { data, numComponents: 4 },
            },
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'particle-render-pipeline',
            code: particles,
            vertexBuffers: geometry.bufferLayouts,
            cullMode: 'none',
        });

        let renderBGs;
        this.particles = new Mesh(this.gpu, {
            label: 'particles',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => {
                const makeBG = (posBuf) =>
                    this.gpu.device.createBindGroup({
                        layout: pipeline.bindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniformBuffer } },
                            { binding: 1, resource: { buffer: posBuf } },
                        ],
                    });
                renderBGs = [makeBG(this.positionBufferWrite), makeBG(this.positionBufferRead)];
                return [renderBGs[0]];
            },
        });
        this.renderBGs = renderBGs;

        this.scene.addChild(this.particles);

        this.renderer.addResizeHandler(this.handleResize);
        this.handleResize();

        this.gpu.renderer.add(this.update);
    }

    update = () => {
        this.renderer.setClearColor({ r: 0.01, g: 0.01, b: 0.01 });

        const encoder = this.gpu.device.createCommandEncoder({
            label: 'simulation-encoder',
        });

        let pass = encoder.beginComputePass({ label: 'sim-compute-pass' });

        this.simUniforms.set({
            time: this.renderer.time,
            uDt: this.renderer.deltaTime,
        });

        this.gpu.device.queue.writeBuffer(this.simUniformBuffer, 0, this.simUniforms.arrayBuffer);

        this.computeShader.dispatch(encoder, {
            pass,
            kernel: this.computeShader.findKernel('simulate'),
            bindGroup: this.simBindGroups[this.t % 2],
            dispatchCount: [this.threadGroupCount, 1, 1],
        });

        pass.end();
        const commandBuffer = encoder.finish();
        this.gpu.device.queue.submit([commandBuffer]);

        this.particles.bindGroups[0] = this.renderBGs[this.t % 2];

        this.gpu.renderer.clearColor = { r: 0.93, g: 0.93, b: 0.93, a: 1 };
        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();

        this.t++;
    };

    handleResize = () => {
        if (!this.renderer.canvas.height) return;
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
