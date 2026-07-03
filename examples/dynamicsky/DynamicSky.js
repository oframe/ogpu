// Dynamic sky + sun demo: a roughness × metalness sphere grid lit entirely by
// the sky's dynamic IBL (prefiltered specular cube + runtime-projected SH),
// with the sky background, a time-of-day scrubber and the palette/grading GUI.
// Plain swapchain path — the same Sky module also runs through the post
// composer by passing `post` (see src/modules/sky/CLAUDE.md).

import { makeStructuredView, primitives } from 'webgpu-utils';

import pbr from '@modules/pbr/pbr.wgsl?raw';
import { Sky } from '@modules/sky/Sky.js';

import { Renderer, Camera, Orbit, Transform, Mesh, Geometry, RenderPipeline, GUI, createUniformBuffer, createBrdfLUT } from 'ogpu';

export class DynamicSky {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.scene = new Transform();

        this.camera = new Camera({ aspect: this.gpu.canvas.width / this.gpu.canvas.height, fov: 40 });
        this.camera.position.set(0, 1.2, 7);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.sky = new Sky(this.gpu, {
            preset: 'physical',
            timeOfDay: 9.5,
            ibl: { faceSize: 128, samples: 256, budget: 6 },
        });
        this.scene.addChild(this.sky.mesh);

        this.initSpheres();
        this.initPane();

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 150);

        this.renderer.add(this.update);
    }

    initSpheres() {
        const { gpu } = this;
        const ibl = this.sky.ibl;

        // pbr.wgsl declares a @location(3) tangent input the sphere primitive
        // doesn't carry — zero-fill it (hasTangents = 0 -> screen-space path).
        const s = primitives.createSphereVertices({ radius: 0.42, subdivisionsAxis: 48, subdivisionsHeight: 24 });
        const geometry = new Geometry(gpu, {
            data: {
                position: { data: s.position, numComponents: 3, type: Float32Array },
                normal: { data: s.normal, numComponents: 3, type: Float32Array },
                uv: { data: s.texcoord, numComponents: 2, type: Float32Array },
                tangent: { data: new Float32Array((s.position.length / 3) * 4), numComponents: 4, type: Float32Array },
                indices: s.indices,
            },
        });

        const pipeline = new RenderPipeline(gpu, {
            label: 'dynamic-sky-pbr-pipeline',
            code: pbr,
            vertexBuffers: geometry.bufferLayouts,
            // dynamic mip count feeds the roughness->lod mapping
            constants: { roughnessLevels: ibl.prefiltered.mipLevels },
        });

        const iblSampler = gpu.device.createSampler({
            label: 'dynamic-sky-ibl-sampler',
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });
        const materialSampler = gpu.device.createSampler({
            label: 'dynamic-sky-material-sampler',
            minFilter: 'linear',
            magFilter: 'linear',
        });

        const white = this.solidTexture([255, 255, 255, 255], 'white-placeholder').createView();
        const black = this.solidTexture([0, 0, 0, 255], 'black-placeholder').createView();
        const brdf = createBrdfLUT(gpu).createView();

        const cols = 6;
        const rows = 2;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const materialView = makeStructuredView(pipeline.defs.uniforms.material);
                materialView.set({
                    baseColorFactor: row === 0 ? [0.9, 0.9, 0.9, 1] : [0.6, 0.15, 0.12, 1],
                    emissiveFactor: [0, 0, 0],
                    metallicFactor: row === 0 ? 1 : 0,
                    roughnessFactor: Math.max(0.05, col / (cols - 1)),
                    normalScale: 1,
                    occlusionStrength: 0,
                    alphaCutoff: 0.5,
                    alphaMode: 0,
                    hasNormalMap: 0,
                    hasTangents: 0,
                    useGeometricNormal: 1,
                });
                const materialBuffer = createUniformBuffer(gpu, {
                    label: `dynamic-sky-material-${row}-${col}`,
                    size: materialView.arrayBuffer.byteLength,
                });
                gpu.device.queue.writeBuffer(materialBuffer, 0, materialView.arrayBuffer);

                const mesh = new Mesh(gpu, {
                    label: `dynamic-sky-sphere-${row}-${col}`,
                    pipeline,
                    geometry,
                    bindGroups: (uniformBuffer) => [
                        gpu.device.createBindGroup({
                            label: `dynamic-sky-sphere-bg-${row}-${col}`,
                            layout: pipeline.bindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: uniformBuffer } },
                                { binding: 1, resource: ibl.prefiltered.view },
                                { binding: 2, resource: { buffer: ibl.shBuffer } },
                                { binding: 3, resource: brdf },
                                { binding: 4, resource: iblSampler },
                                { binding: 5, resource: white }, // tMap
                                { binding: 6, resource: white }, // tMetallicRoughness (factors drive it)
                                { binding: 7, resource: white }, // tNormal (unused)
                                { binding: 8, resource: white }, // tOcclusion
                                { binding: 9, resource: black }, // tEmissive
                                { binding: 10, resource: materialSampler },
                                { binding: 11, resource: white }, // tOpacity
                                { binding: 12, resource: { buffer: materialBuffer } },
                            ],
                        }),
                    ],
                });
                mesh.position.set((col - (cols - 1) / 2) * 1.05, (row - (rows - 1) / 2) * 1.15, 0);
                mesh.setParent(this.scene);
            }
        }
    }

    solidTexture(rgba, label) {
        const texture = this.gpu.device.createTexture({
            size: [2, 2],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label,
        });
        const data = new Uint8Array(2 * 2 * 4);
        for (let i = 0; i < 4; i++) data.set(rgba, i * 4);
        this.gpu.device.queue.writeTexture({ texture }, data, { bytesPerRow: 8, rowsPerImage: 2 }, { width: 2, height: 2 });
        return texture;
    }

    initPane() {
        this.gui = new GUI({ title: 'dynamic-sky', expanded: true });
        this.sky.addGUI(this.gui);
    }

    update = ({ deltaTime = 0 } = {}) => {
        this.orbit.update();
        this.sky.update({ deltaTime });
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
