import { Camera, Renderer, Transform, Orbit, createStorageBuffer, ComputeShader, UniformBuffer, Geometry, Shader, Mesh, Quad, GUI } from 'ogpu';

import sim from './sim.wgsl?raw';
import particles from './particles.wgsl?raw';

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

        this.velocityBuffer = createStorageBuffer(this.gpu, { label: 'velocity-data', data: velocityData });
        this.positionBufferRead = createStorageBuffer(this.gpu, { label: 'position-data-read', data: positionData });
        this.positionBufferWrite = createStorageBuffer(this.gpu, { label: 'position-data-write', data: positionData });

        this.computeShader = new ComputeShader(this.gpu, {
            label: 'compute-shader-example',
            code: sim,
        });

        const { uniforms } = this.computeShader.defs;

        this.simUniforms = new UniformBuffer(this.gpu, uniforms.uniforms, { time: 0, uDt: 0 }, { label: 'sim-uniforms' });

        this.velocityUniforms = new UniformBuffer(
            this.gpu,
            uniforms.velocityUniforms,
            {
                uSpatialFreq: 0.443,
                uTemporalFreq: 0.15,
                uAmp: 0.5,
                uIntertia: 1.3,
                uConstraintRadius: 1.0,
            },
            { label: 'velocity-uniforms' }
        );

        // noise params live in velocityUniforms; GUI edits upload on change
        this.gui = new GUI({ title: 'particles' });
        const noise = this.gui.folder('noise');
        noise.uniform(this.velocityUniforms, 'uSpatialFreq', { label: 'spatialFreq', min: 0, max: 2, step: 0.001 });
        noise.uniform(this.velocityUniforms, 'uTemporalFreq', { label: 'temporalFreq', min: 0, max: 1, step: 0.001 });
        noise.uniform(this.velocityUniforms, 'uAmp', { label: 'amp', min: 0, max: 2, step: 0.001 });
        noise.uniform(this.velocityUniforms, 'uIntertia', { label: 'intertia', min: 0, max: 5, step: 0.001 });
        noise.uniform(this.velocityUniforms, 'uConstraintRadius', { label: 'constraintRadius', min: 0, max: 3, step: 0.001 });

        /**
         * this example is intentionally verbose to demonstrate how to ping-pong
         * buffers in WebGPU. here we are ping-ponging the positions and keeping
         * velocity as read_write.
         *
         * we prebuild two bind groups (read A/write B, read B/write A) from the
         * kernel's layout (computeShader.bindGroupLayout('simulate', 0)) and swap by index
         * each frame — the caller owns the bind groups; ComputeShader only serves
         * the layout.
         */

        // state 0: read A / write B. state 1: read B / write A. swap each frame.
        const pingPong = [
            [this.positionBufferRead, this.positionBufferWrite],
            [this.positionBufferWrite, this.positionBufferRead],
        ];

        this.simBindGroups = pingPong.map(([read, write], i) =>
            this.computeShader.bindGroupLayout('simulate', 0).createBindGroup(
                {
                    uniforms: this.simUniforms,
                    velocityUniforms: this.velocityUniforms,
                    velocityData: this.velocityBuffer,
                    positionDataRead: read,
                    positionDataWrite: write,
                },
                { label: `sim-bind-group-${i}` }
            )
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

        const shader = new Shader(this.gpu, { label: 'particle-shader', code: particles });

        // one bind group per ping-pong state, swapped by index each frame
        this.renderBGs = [this.positionBufferWrite, this.positionBufferRead].map((positionData) => shader.bindGroupLayout(0).createBindGroup({ positionData }));

        this.particles = new Mesh({
            label: 'particles',
            geometry,
            shader,
            state: { cullMode: 'none' },
            bindGroups: [this.renderBGs[0]],
        });

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
