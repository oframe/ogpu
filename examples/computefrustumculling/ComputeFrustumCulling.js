import { Renderer, Camera, Orbit, Transform, Mesh, Geometry, Texture, Shader, ComputeShader, Vec3, createStorageBuffer, UniformBuffer, Cone, loadJSON } from 'ogpu';

import fieldShader from './field.wgsl?raw';
import cameraMarkerShader from './cameramarker.wgsl?raw';
import cullShader from './cull.wgsl?raw';

// GPU compute frustum culling — same scene as the CPU `frustumculling` example
// (a cone field swept by a demo camera, OGL-style), but the per-frame visibility
// test runs on the GPU. A compute pass tests each cone's baked bounding sphere
// against the demo camera's 6 frustum planes, atomic-appends survivors into a
// `visible` index buffer, and writes the count into a drawIndexedIndirect args
// buffer. The field is then drawn with ONE indirect instanced draw.
const SIZE = 20;
const NUM = SIZE * SIZE;

export class ComputeFrustumCulling {
    constructor() {
        this.frustumTarget = new Vec3();
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(6, 6, 12);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        // Demo camera used purely for the cull test — narrow + short far so only
        // a slice of the field is ever inside it.
        this.frustumCamera = new Camera({ fov: 65, far: 10, aspect: 1 });

        this.scene = new Transform();

        await this._initField();
        this._initCull();
        this._initMarker();
        this._initInfo();

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    async _initField() {
        // Shared forest model (Google Poly, same as the OGL example); drawn
        // instanced + indirect. Geometry is position + uv (non-indexed); the
        // textured field shader samples forest.jpg.
        const data = await loadJSON('./assets/frustumculling/forest.json');
        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                uv: { data: data.uv, numComponents: 2, type: Float32Array },
            },
        });
        geometry.computeBoundingSphere();
        this.vertexCount = geometry.nonInstancedVerts.numElements;

        // Bake a model matrix + world bounding sphere per instance (the trees
        // never move). Layout matches the CPU example exactly.
        const models = new Float32Array(NUM * 16);
        const spheres = new Float32Array(NUM * 4);
        const tmp = new Transform();
        const center = new Vec3();
        const { center: localCenter, radius: localRadius } = geometry.bounds;

        for (let i = 0; i < NUM; i++) {
            const x = ((i % SIZE) - SIZE * 0.5) * 2;
            const z = (Math.floor(i / SIZE) - SIZE * 0.5) * 2;
            const y = Math.sin(x * 0.5) * Math.sin(z * 0.5) * 0.5;
            const s = 0.8 + Math.random() * 0.4;

            tmp.position.set(x, y, z);
            tmp.rotation.y = Math.random() * Math.PI * 2;
            tmp.scale.set(s, s, s);
            tmp.updateMatrix();
            models.set(tmp.matrix, i * 16);

            center.copy(localCenter).applyMat4(tmp.matrix);
            spheres[i * 4 + 0] = center.x;
            spheres[i * 4 + 1] = center.y;
            spheres[i * 4 + 2] = center.z;
            spheres[i * 4 + 3] = localRadius * tmp.matrix.getMaxScaleOnAxis();
        }

        this.modelBuffer = createStorageBuffer(this.gpu, { label: 'models', data: models });
        this.sphereBuffer = createStorageBuffer(this.gpu, { label: 'spheres', data: spheres });

        // compact list of visible instance indices, filled by the cull pass.
        this.visibleBuffer = createStorageBuffer(this.gpu, { label: 'visible-indices', size: NUM * 4 });

        // drawIndirect args: [vertexCount, instanceCount, firstVertex,
        // firstInstance]. instanceCount is written by the GPU.
        this.argsBuffer = createStorageBuffer(this.gpu, {
            label: 'draw-args',
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
            data: new Uint32Array([this.vertexCount, 0, 0, 0]),
        });
        geometry.drawBuffer = this.argsBuffer;

        // forest.jpg texture + sampler, shared by every instance.
        const texture = new Texture(this.gpu, { src: './assets/frustumculling/forest.jpg', mips: true });
        await texture.ready;
        const textureView = texture.createView();
        const sampler = this.gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        const shader = new Shader(this.gpu, { label: 'compute-frustum-field-shader', code: fieldShader });
        this.field = new Mesh({
            label: 'tree-field',
            geometry,
            shader,
            frustumCulled: false,
            // group(1) is the engine's; the instance buffers live at group(2)
            bindGroups: [
                shader.bindGroupLayout(0).createBindGroup({ textureSampler: sampler, tMap: textureView }),
                null,
                shader.bindGroupLayout(2).createBindGroup({ models: this.modelBuffer, visible: this.visibleBuffer }),
            ],
        });
        this.field.setParent(this.scene);
    }

    _initCull() {
        this.cull = new ComputeShader(this.gpu, { label: 'cull-shader', code: cullShader });
        // CullUniforms: 6 planes (vec4) + count; the planes are rewritten every cull
        this.cullUniform = new UniformBuffer(this.gpu, this.cull.defs.uniforms.u, { count: NUM }, { label: 'cull-uniform' });
        this.cullKernel = this.cull.findKernel('cull');
        this.cullBindGroup = this.cull.bindGroupLayout('cull', 0).createBindGroup(
            {
                u: this.cullUniform,
                spheres: this.sphereBuffer,
                visible: this.visibleBuffer,
                args: this.argsBuffer,
            },
            { label: 'cull-bind-group' }
        );
    }

    _initMarker() {
        // Camera-shape marker for the demo camera (port of the OGL gizmo): a
        // 4-sided open truncated cone, normal-colored, riding the demo camera.
        this.frustumTransform = new Transform();
        this.frustumTransform.setParent(this.scene);

        const geometry = new Cone(this.gpu, {
            topRadius: 0.5,
            bottomRadius: 0.2,
            height: 0.7,
            radialSubdivisions: 4,
            topCap: false,
            bottomCap: false,
        });

        const shader = new Shader(this.gpu, { label: 'compute-frustum-marker-shader', code: cameraMarkerShader });

        this.marker = new Mesh({
            label: 'camera-marker',
            geometry,
            shader,
            state: { cullMode: 'none' },
            frustumCulled: false,
        });

        this.marker.rotation.x = -Math.PI / 2;
        this.marker.rotation.y = Math.PI / 4;
        this.marker.setParent(this.frustumTransform);
    }

    _initInfo() {
        this.info = document.createElement('div');
        this.info.className = 'InfoBar';
        this.info.textContent = 'Frustum Culling — GPU compute (indirect instanced draw)';
        document.body.appendChild(this.info);
    }

    cameraPath(vec, time, y) {
        vec.set(4 * Math.sin(time), y, 2 * Math.sin(time * 2));
    }

    _runCull() {
        const planes = this.cullUniform.views.planes;
        for (let i = 0; i < 6; i++) {
            const p = this.frustumCamera.frustum[i];
            planes[i * 4 + 0] = p.x;
            planes[i * 4 + 1] = p.y;
            planes[i * 4 + 2] = p.z;
            planes[i * 4 + 3] = p.constant;
        }
        this.cullUniform.upload();

        // reset instanceCount to 0 (keep vertexCount); the cull pass atomic-adds.
        this.gpu.device.queue.writeBuffer(this.argsBuffer, 4, new Uint32Array([0]));

        const encoder = this.gpu.device.createCommandEncoder({ label: 'cull-encoder' });
        this.cull.dispatch(encoder, {
            kernel: this.cullKernel,
            bindGroup: this.cullBindGroup,
            dispatchCount: [Math.ceil(NUM / 64), 1, 1],
        });
        this.gpu.device.queue.submit([encoder.finish()]);
    }

    update = () => {
        requestAnimationFrame(this.update);

        const t = performance.now() * 0.001;

        this.cameraPath(this.frustumCamera.position, t, 2);
        this.cameraPath(this.frustumTarget, t + 1, 1);
        this.frustumCamera.lookAt(this.frustumTarget);
        this.frustumCamera.updateMatrixWorld();
        this.frustumCamera.updateFrustum();

        // Ride the marker along with the demo camera's pose.
        this.frustumTransform.position.copy(this.frustumCamera.position);
        this.frustumTransform.quaternion.copy(this.frustumCamera.quaternion);

        this._runCull();

        this.renderer.render({ scene: this.scene, camera: this.camera, frustumCull: false });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
