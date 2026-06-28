import { Pane } from 'tweakpane';
import { makeStructuredView } from 'webgpu-utils';

import pbr from '@modules/pbr/pbr.wgsl?raw';
import probe from './probe.wgsl?raw';
import shadowShader from './shadow.wgsl?raw';

import {
    Renderer,
    Geometry,
    Mesh,
    RenderPipeline,
    Transform,
    Camera,
    Orbit,
    Vec3,
    Sphere,
    Plane,
    Texture,
    createUniformBuffer,
    loadIBLCubeMap,
    loadSphericalHarmonics,
    loadJSON,
    createBrdfLUT,
} from 'ogpu';

export class PBRShader {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        await this.initTestScene();
        this.initPane();

        addEventListener('resize', this.handleResize);
        setTimeout((_) => {
            this.handleResize();
        }, 150);

        this.gpu.renderer.add(this.update);
    }

    async initTestScene() {
        this.sceneOne = new Transform();
        this.sceneOne.position.y = -0.4;

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 35,
        });

        this.camera.position.set(2, 0.5, 3);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.whiteTex = this.solidTexture([255, 255, 255, 255], 'white placeholder');
        this.blackTex = this.solidTexture([0, 0, 0, 255], 'black placeholder');

        const ibl = (this.ibl = await this.initIBL());

        this.params = {
            roughnessFactor: 1.0,
            metallicFactor: 1.0,
            occlusionStrength: 1.0,
            baseColor: { r: 1, g: 1, b: 1 },
            useGeometricNormal: false,
        };

        this.iblSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });
        this.materialSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        this.carMeshes = [];

        // White fallback for parts with no opacity map (fully opaque).
        const opaqueView = this.whiteTex.createView();

        // Exterior body + inner shell share one set of material maps. The opacity
        // map (green channel) drives glass transparency, so it's drawn transparent.
        const extColor = await this.loadTexture('./assets/pbrshader/car-ext-color.jpg');
        const extRMO = await this.swizzleRMO('./assets/pbrshader/car-ext-rmo.jpg');
        const extNormal = await this.loadTexture('./assets/pbrshader/car-ext-normal.jpg');
        const extEmissive = await this.loadTexture('./assets/pbrshader/car-ext-emissive.jpg');
        const extOpacity = await this.loadTexture('./assets/pbrshader/car-ext-opacity.jpg');
        const extMaps = {
            baseView: extColor.createView(),
            rmoView: extRMO.createView(),
            normalView: extNormal.createView(),
            emissiveView: extEmissive.createView(),
            opacityView: extOpacity.createView(),
            emissiveFactor: [1, 1, 1],
        };
        await this.addCarPart('./assets/pbrshader/car-ext.json', extMaps, { transparent: true });
        await this.addCarPart('./assets/pbrshader/car-ext-inner.json', extMaps, { transparent: true });

        // Interior — no emissive or opacity map.
        const intColor = await this.loadTexture('./assets/pbrshader/car-int-color.jpg');
        const intRMO = await this.swizzleRMO('./assets/pbrshader/car-int-rmo.jpg');
        const intNormal = await this.loadTexture('./assets/pbrshader/car-int-normal.jpg');
        await this.addCarPart('./assets/pbrshader/car-int.json', {
            baseView: intColor.createView(),
            rmoView: intRMO.createView(),
            normalView: intNormal.createView(),
            emissiveView: this.blackTex.createView(),
            opacityView: opaqueView,
            emissiveFactor: [0, 0, 0],
        });

        await this.addShadowFloor();

        this.initProbes(ibl);
    }

    // Loads an image texture and waits for it to be GPU-ready.
    async loadTexture(url) {
        const tex = new Texture(this.gpu, { src: url });
        await tex.ready;
        return tex;
    }

    // OGPU's pbr.wgsl reads roughness from .g, metalness from .b, occlusion from .r
    // (across the MR + occlusion slots). The car's RMO map packs them as R/G/B =
    // roughness/metalness/occlusion, so repack into r=occlusion, g=roughness,
    // b=metalness and bind the one texture to both the MR and occlusion slots.
    async swizzleRMO(url) {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            d[i] = b; // occlusion
            d[i + 1] = r; // roughness
            d[i + 2] = g; // metalness
        }
        ctx.putImageData(img, 0, 0);

        const texture = this.gpu.device.createTexture({
            size: [bitmap.width, bitmap.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            label: 'rmo-swizzled',
        });
        this.gpu.device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [bitmap.width, bitmap.height]);
        return texture;
    }

    async addCarPart(jsonUrl, maps, { transparent = false } = {}) {
        const data = await loadJSON(jsonUrl);

        // UV coordinates along Y are flipped in WebGPU vs the source image, so
        // flip V on the model's UVs (same fix as the skinning example). Done here
        // rather than in pbr.wgsl since that shader is shared with the gltf example.
        const uv = Float32Array.from(data.uv);
        for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];

        // pbr.wgsl declares a @location(3) tangent input; the car JSON has none.
        // Zero-fill it — hasTangents = 0 makes the shader take the screen-space path.
        const vertexCount = data.position.length / 3;
        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: data.position, numComponents: 3, type: Float32Array },
                normal: { data: data.normal, numComponents: 3, type: Float32Array },
                uv: { data: uv, numComponents: 2, type: Float32Array },
                tangent: { data: new Float32Array(vertexCount * 4), numComponents: 4, type: Float32Array },
            },
        });

        const ibl = this.ibl;
        const pipeline = new RenderPipeline(this.gpu, {
            label: `car-pipeline-${this.carMeshes.length}`,
            vertexBuffers: geometry.bufferLayouts,
            code: pbr,
            constants: { roughnessLevels: ibl.mipLevels },
            transparent,
        });

        // Material factors live in their own uniform block (binding 12).
        const materialView = makeStructuredView(pipeline.defs.uniforms.material);
        materialView.set({
            baseColorFactor: [1, 1, 1, 1],
            emissiveFactor: maps.emissiveFactor,
            metallicFactor: this.params.metallicFactor,
            roughnessFactor: this.params.roughnessFactor,
            normalScale: 0.5,
            occlusionStrength: this.params.occlusionStrength,
            alphaCutoff: 0.5,
            alphaMode: 0,
            hasNormalMap: 1,
            hasTangents: geometry.hasTangents ? 1 : 0,
            useGeometricNormal: 0,
        });
        const materialBuffer = createUniformBuffer(this.gpu, {
            label: `car-material-${this.carMeshes.length}`,
            size: materialView.arrayBuffer.byteLength,
        });
        this.gpu.device.queue.writeBuffer(materialBuffer, 0, materialView.arrayBuffer);

        const mesh = new Mesh(this.gpu, {
            label: `car-mesh-${this.carMeshes.length}`,
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: ibl.specView },
                        { binding: 2, resource: { buffer: ibl.shBuffer } },
                        { binding: 3, resource: ibl.lutTexture.createView() },
                        { binding: 4, resource: this.iblSampler },
                        { binding: 5, resource: maps.baseView }, // tMap
                        { binding: 6, resource: maps.rmoView }, // tMetallicRoughness (g/b)
                        { binding: 7, resource: maps.normalView }, // tNormal
                        { binding: 8, resource: maps.rmoView }, // tOcclusion (r)
                        { binding: 9, resource: maps.emissiveView }, // tEmissive
                        { binding: 10, resource: this.materialSampler },
                        { binding: 11, resource: maps.opacityView }, // tOpacity (g)
                        { binding: 12, resource: { buffer: materialBuffer } },
                    ],
                }),
            ],
        });

        // Keep the material view + buffer on the mesh so the pane can update them.
        mesh.material = { view: materialView, buffer: materialBuffer };

        mesh.setParent(this.sceneOne);
        this.carMeshes.push(mesh);
        return mesh;
    }

    async addShadowFloor() {
        const geometry = new Plane(this.gpu, { width: 2.3, depth: 2.3 });
        const tex = await this.loadTexture('./assets/pbrshader/car-shadow.jpg');
        const view = tex.createView();
        const sampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'car-shadow-pipeline',
            vertexBuffers: geometry.bufferLayouts,
            code: shadowShader,
            transparent: true,
            cullMode: 'none',
        });

        const mesh = new Mesh(this.gpu, {
            label: 'car-shadow',
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
        mesh.setParent(this.sceneOne);
    }

    // Two debug spheres: SH irradiance + specular cube. Toggled via the pane.
    initProbes(ibl) {
        const geometry = new Sphere(this.gpu, { radius: 0.8 });

        const iblSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });

        const makeProbe = (mode, position) => {
            const pipeline = new RenderPipeline(this.gpu, {
                label: `probe-pipeline-mode-${mode}`,
                vertexBuffers: geometry.bufferLayouts,
                code: probe,
            });

            const mesh = new Mesh(this.gpu, {
                label: `probe-mesh-mode-${mode}`,
                pipeline,
                geometry,
                bindGroups: (uniformBuffer) => [
                    this.gpu.device.createBindGroup({
                        label: `probe-bind-group-mode-${mode}`,
                        layout: pipeline.bindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniformBuffer } },
                            { binding: 1, resource: ibl.specView },
                            { binding: 2, resource: { buffer: ibl.shBuffer } },
                            { binding: 3, resource: iblSampler },
                        ],
                    }),
                ],
            });

            mesh.uniforms.set({ mode });
            mesh.position.copy(position);
            mesh.setParent(this.probes);
            return mesh;
        };

        this.probes = new Transform();
        this.probes.setParent(this.sceneOne);
        this.probeSH = makeProbe(0, new Vec3(-2.5, 1.0, 0));
        this.probeSpecular = makeProbe(1, new Vec3(-2.5, -1.0, 0));

        this.showProbes = false;
        this.probes.visible = this.showProbes;
    }

    async initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.json' } = {}) {
        const ibl = await loadIBLCubeMap(this.gpu, {
            url,
            faceSize: 256,
            mipLevels: 6,
            label: 'specular-ibl',
        });

        const shArray = await loadSphericalHarmonics(shUrl);
        const shBuffer = createUniformBuffer(this.gpu, {
            label: 'sh-constants-buffer',
            size: shArray.byteLength,
        });
        this.gpu.device.queue.writeBuffer(shBuffer, 0, shArray);

        const lutTexture = createBrdfLUT(this.gpu);

        return { specView: ibl.view, mipLevels: ibl.mipLevels, shBuffer, lutTexture };
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
        this.pane = new Pane({ title: 'pbr' });

        const apply = () => {
            for (const mesh of this.carMeshes) {
                mesh.material.view.set({
                    roughnessFactor: this.params.roughnessFactor,
                    metallicFactor: this.params.metallicFactor,
                    occlusionStrength: this.params.occlusionStrength,
                    baseColorFactor: [this.params.baseColor.r, this.params.baseColor.g, this.params.baseColor.b, 1.0],
                    useGeometricNormal: this.params.useGeometricNormal ? 1 : 0,
                });
                this.gpu.device.queue.writeBuffer(mesh.material.buffer, 0, mesh.material.view.arrayBuffer);
            }
        };

        this.pane
            .addBinding(this.params, 'roughnessFactor', {
                label: 'roughness',
                min: 0,
                max: 1,
                step: 0.001,
            })
            .on('change', apply);
        this.pane
            .addBinding(this.params, 'metallicFactor', {
                label: 'metalness',
                min: 0,
                max: 1,
                step: 0.001,
            })
            .on('change', apply);
        this.pane
            .addBinding(this.params, 'occlusionStrength', {
                label: 'ao',
                min: 0,
                max: 1,
                step: 0.001,
            })
            .on('change', apply);
        this.pane.addBinding(this.params, 'baseColor', { label: 'albedo', color: { type: 'float' } }).on('change', apply);

        this.pane.addBinding(this.params, 'useGeometricNormal', { label: 'geo-normals' }).on('change', apply);

        this.pane.addBinding(this, 'showProbes', { label: 'ibl-probes' }).on('change', (ev) => {
            this.probes.visible = ev.value;
        });
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        this.orbit.update();

        this.sceneOne.rotation.y += 0.005;

        this.gpu.renderer.clearColor = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
        this.renderer.render({ scene: this.sceneOne, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
