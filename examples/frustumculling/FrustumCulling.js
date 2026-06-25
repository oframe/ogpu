import { Camera, Renderer, Orbit, RenderPipeline, Mesh, Geometry, Texture, Transform, Vec3, Cone, loadJSON } from 'ogpu';

import fieldShader from './field.wgsl?raw';
import cameraMarkerShader from './cameramarker.wgsl?raw';

// Frustum Culling — port of the OGL example. A wide field of meshes is culled
// each frame against a SECOND demo camera (not the one we render from) that
// sweeps along a path. The main orbit camera sees the whole field, so meshes
// visibly pop in/out as the demo frustum passes over them. A red cylinder marks
// where the demo camera sits, and an Info panel reports visible/total.
export class FrustumCulling {
    constructor() {
        this.init();
    }

    async init() {
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        // Main camera we actually render from — close in, matching the OGL
        // framing so the field fills the view (far back = tiny specks).
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(6, 6, 12);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        // Demo camera used purely for the frustum test — narrow + short far so
        // only a slice of the field is ever inside it.
        this.frustumCamera = new Camera({ fov: 65, far: 10, aspect: 1 });
        this.frustumTarget = new Vec3();

        // Shared forest model (Google Poly, same as the OGL example) + pipeline
        // across the whole field (cheap, many meshes). Geometry is position + uv;
        // the textured field shader samples forest.jpg.
        const data = await loadJSON('./assets/frustumculling/forest.json');
        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                uv: { data: data.uv, numComponents: 2, type: Float32Array },
            },
        });
        const pipeline = new RenderPipeline(this.gpu, {
            label: 'frustum-field-pipeline',
            code: fieldShader,
            vertexBuffers: geometry.bufferLayouts,
        });

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

        const fieldBindGroups = (uniformBuffer) => [
            this.gpu.device.createBindGroup({
                layout: pipeline.bindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: sampler },
                    { binding: 2, resource: textureView },
                ],
            }),
        ];

        const makeBindGroups = (pl) => (uniformBuffer) => [
            this.gpu.device.createBindGroup({
                layout: pl.bindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
            }),
        ];

        // Field: a size x size grid spread across a wide area.
        const size = 20;
        const num = size * size;
        this.field = [];
        for (let i = 0; i < num; i++) {
            const mesh = new Mesh(this.gpu, {
                label: `tree-${i}`,
                pipeline,
                geometry,
                bindGroups: fieldBindGroups,
            });

            const x = ((i % size) - size * 0.5) * 2;
            const z = (Math.floor(i / size) - size * 0.5) * 2;
            const y = Math.sin(x * 0.5) * Math.sin(z * 0.5) * 0.5;
            mesh.position.set(x, y, z);
            mesh.rotation.y = Math.random() * Math.PI * 2;
            const s = 0.8 + Math.random() * 0.4;
            mesh.scale.set(s, s, s);

            // We drive visibility ourselves from the demo camera, so keep the
            // renderer's own auto-cull (against the main camera) out of it.
            mesh.frustumCulled = false;

            mesh.setParent(this.scene);
            this.field.push(mesh);
        }

        // Camera-shape marker for the demo camera (port of the OGL gizmo): a
        // 4-sided open truncated cone, normal-colored. Parented to a transform
        // that copies the demo camera's pose each frame, so it rides along.
        this.frustumTransform = new Transform();
        this.frustumTransform.setParent(this.scene);

        const markerGeometry = new Cone(this.gpu, {
            topRadius: 0.5,
            bottomRadius: 0.2,
            height: 0.7,
            radialSubdivisions: 4,
            topCap: false,
            bottomCap: false,
        });
        const markerPipeline = new RenderPipeline(this.gpu, {
            label: 'frustum-marker-pipeline',
            code: cameraMarkerShader,
            vertexBuffers: markerGeometry.bufferLayouts,
            cullMode: 'none',
        });
        this.marker = new Mesh(this.gpu, {
            label: 'camera-marker',
            pipeline: markerPipeline,
            geometry: markerGeometry,
            frustumCulled: false,
            bindGroups: makeBindGroups(markerPipeline),
        });
        // OGL's fixed local orientation so the cone points along the camera.
        this.marker.rotation.x = -Math.PI / 2;
        this.marker.rotation.y = Math.PI / 4;
        this.marker.setParent(this.frustumTransform);

        this.info = document.createElement('div');
        this.info.className = 'InfoBar';
        document.body.appendChild(this.info);

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.update();
    }

    cameraPath(vec, time, y) {
        vec.set(4 * Math.sin(time), y, 2 * Math.sin(time * 2));
    }

    update = () => {
        requestAnimationFrame(this.update);

        const t = performance.now() * 0.001;

        // Move the demo camera around a path and aim it along the path.
        this.cameraPath(this.frustumCamera.position, t, 2);
        this.cameraPath(this.frustumTarget, t + 1, 1);
        this.frustumCamera.lookAt(this.frustumTarget);
        this.frustumCamera.updateMatrixWorld();
        this.frustumCamera.updateFrustum();

        // Ride the marker along with the demo camera's pose.
        this.frustumTransform.position.copy(this.frustumCamera.position);
        this.frustumTransform.quaternion.copy(this.frustumCamera.quaternion);

        // Scene world matrices must be current before the frustum test reads
        // each mesh's worldMatrix (renderer.render also refreshes them, but the
        // cull happens here, before that call).
        this.scene.updateMatrixWorld();

        // Cull the field against the demo camera's frustum.
        let visible = 0;
        for (const mesh of this.field) {
            mesh.visible = this.frustumCamera.frustumIntersectsMesh(mesh);
            if (mesh.visible) visible++;
        }
        this.info.textContent = `Frustum Culling — visible ${visible} / ${this.field.length}`;

        // Render from the main camera; disable renderer auto-cull so only our
        // demo-camera visibility flags decide what draws.
        this.renderer.render({ scene: this.scene, camera: this.camera, frustumCull: false });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
