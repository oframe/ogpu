import { Camera, Renderer, Transform, Orbit, Skin, Animation, Mesh, Geometry, GLTFLoader, RenderPipeline, createUniformBuffer, loadIBLCubeMap, loadSphericalHarmonics, createBrdfLUT } from 'ogpu';
import { makeStructuredView } from 'webgpu-utils';

import skinnedmesh from './skinnedmesh.wgsl?raw';

// glTF rig + animation skinning, PBR-lit (metallic-roughness + IBL). The JSON
// path lives in examples/skinning.
//
// The PBR shading on the skinned mesh was folded in via the pbr-shading skill.
//
// The whole skinned-PBR setup below (Skin + Animation, geometry, material maps +
// fallbacks, IBL bindings) is also available turnkey as
// `loader.getSkinnedMesh({ code, ibl })` — it returns { mesh, skin, animation }.
// This example deliberately keeps the manual path to show how you unfold a glTF
// mesh and perform the wirings yourself.
export class SkinningGLTF {
    constructor(canvas) {
        this.init(canvas);
    }

    async init(canvas) {
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;

        this.gpu = this.renderer.gpu;

        this.scene = new Transform();
        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            far: 300,
            fov: 35,
        });

        this.camera.position.set(6, 2, 6);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas, target: [0, 1, 0] });

        this.addCredit('Skinning (glTF) + PBR. Animation from <a href="https://www.mixamo.com" target="_blank">Mixamo</a>.');

        addEventListener('resize', this.handleResize);
        setTimeout(this.handleResize, 350);

        const iblPromise = this.initIBL();
        this.renderer.trackCompile(iblPromise); // hold boot overlay until IBL settles
        const ibl = await iblPromise;

        const loader = new GLTFLoader(this.gpu, { dataOnly: true });
        await loader.load('./assets/skinning/mixamo.glb');

        const skinData = loader.getSkinData(0);
        this.skin = new Skin(this.gpu, { label: 'mixamo', data: skinData });

        const animFps = 30;
        const animData = loader.getAnimation({ animation: 0, skin: 0, fps: animFps });
        this.animLabel = animData.label;
        this.skin.addAnimation(
            new Animation({
                label: this.animLabel,
                data: animData,
                transforms: this.skin.poseTransforms,
            }).fps(animFps)
        );

        const geometry = new Geometry(this.gpu, {
            data: {
                position: { data: skinData.position, numComponents: 3, type: Float32Array },
                normal: { data: skinData.normal, numComponents: 3, type: Float32Array },
                uv: { data: skinData.uv, numComponents: 2, type: Float32Array },
                indices: { data: skinData.indices },
            },
        });

        // Real material maps from the glb; fallbacks for the maps it lacks.
        const [baseColor, normalMap, metalRough] = await Promise.all([loader.getMaterialTexture(0, 'baseColor'), loader.getMaterialTexture(0, 'normal'), loader.getMaterialTexture(0, 'metallicRoughness')]);
        const white = this.solidTexture([255, 255, 255, 255], 'white-placeholder');
        const black = this.solidTexture([0, 0, 0, 255], 'black-placeholder');

        const iblSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });
        const materialSampler = this.gpu.device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });

        const pipeline = new RenderPipeline(this.gpu, {
            label: 'skinned-pbr-pipeline',
            code: skinnedmesh,
            vertexBuffers: geometry.bufferLayouts,
            constants: { roughnessLevels: ibl.mipLevels },
        });

        const materialView = makeStructuredView(pipeline.defs.uniforms.material);
        materialView.set({
            baseColorFactor: [1, 1, 1, 1],
            emissiveFactor: [0, 0, 0],
            metallicFactor: 0, // mixamo body: non-metallic
            roughnessFactor: 1,
            normalScale: 1,
            occlusionStrength: 1,
            alphaCutoff: 0.5,
            alphaMode: 0,
            hasNormalMap: 1,
            hasTangents: 0, // skinned geometry carries no tangents -> screen-space frame
            useGeometricNormal: 0,
        });
        const materialBuffer = createUniformBuffer(this.gpu, { label: 'mixamo-material', size: materialView.arrayBuffer.byteLength });
        this.gpu.device.queue.writeBuffer(materialBuffer, 0, materialView.arrayBuffer);

        this.mesh = new Mesh(this.gpu, {
            label: 'mixamo-mesh',
            pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        { binding: 1, resource: { buffer: this.skin.skinnedPositionBuffer } },
                        { binding: 2, resource: { buffer: this.skin.skinnedNormalBuffer } },
                        { binding: 3, resource: ibl.specView },
                        { binding: 4, resource: { buffer: ibl.shBuffer } },
                        { binding: 5, resource: ibl.lutTexture.createView() },
                        { binding: 6, resource: iblSampler },
                        { binding: 7, resource: baseColor.createView() },
                        { binding: 8, resource: metalRough.createView() },
                        { binding: 9, resource: normalMap.createView() },
                        { binding: 10, resource: white.createView() }, // occlusion
                        { binding: 11, resource: black.createView() }, // emissive
                        { binding: 12, resource: materialSampler },
                        { binding: 13, resource: white.createView() }, // opacity
                        { binding: 14, resource: { buffer: materialBuffer } },
                    ],
                }),
            ],
        });
        // positions come from the skin compute buffer, not the bind-pose attribute
        this.mesh.frustumCulled = false;
        this.mesh.addChild(this.skin.root);
        this.scene.addChild(this.mesh);

        this.gpu.renderer.add(this.update);
    }

    // Specular cube + SH irradiance + split-sum BRDF LUT. See pbr-shading skill.
    async initIBL({ url = './assets/pbr/artistworkshop_oct.exr', shUrl = './assets/pbr/artistworkshop_sh.json' } = {}) {
        const ibl = await loadIBLCubeMap(this.gpu, { url, faceSize: 256, mipLevels: 6, label: 'specular-ibl' });

        const shArray = await loadSphericalHarmonics(shUrl);
        const shBuffer = createUniformBuffer(this.gpu, { label: 'sh-constants-buffer', size: shArray.byteLength });
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

    update = ({ deltaTime = 0 } = {}) => {
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        const anim = this.skin.getAnimation(this.animLabel);
        anim.elapsed += deltaTime * anim.fps();
        this.skin.update();

        this.renderer.render({ scene: this.scene, camera: this.camera });
        this.orbit.update();
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };

    addCredit(html) {
        const info = document.createElement('div');
        info.className = 'Info';
        info.innerHTML = html;
        document.body.appendChild(info);
        this.credit = info;
    }
}
