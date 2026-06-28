// glTF/glb loader: parse chunks, decode accessors to packed typed arrays, build
// a Transform graph of Mesh nodes sharing a small pool of RenderPipelines.
// Ref: https://toji.dev/webgpu-gltf-case-study/

import { makeStructuredView } from 'webgpu-utils';
import { createUniformBuffer } from '@utils/BufferUtils';
import { Vec3, Quat, Mat4 } from '@math';

import { Geometry } from '@core/Geometry';
import { Texture } from '@core/Texture';
import { Mesh } from '@core/Mesh';
import { Transform } from '@core/Transform';
import { RenderPipeline } from '@core/RenderPipeline';

// --- glTF constant tables (https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html) ---

const COMPONENT = {
    5120: { array: Int8Array, size: 1, signed: true }, // BYTE
    5121: { array: Uint8Array, size: 1, signed: false }, // UNSIGNED_BYTE
    5122: { array: Int16Array, size: 2, signed: true }, // SHORT
    5123: { array: Uint16Array, size: 2, signed: false }, // UNSIGNED_SHORT
    5125: { array: Uint32Array, size: 4, signed: false }, // UNSIGNED_INT
    5126: { array: Float32Array, size: 4, signed: true }, // FLOAT
};

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// glTF sampler filter / wrap enums -> WebGPU
const WRAP = { 33071: 'clamp-to-edge', 33648: 'mirror-repeat', 10497: 'repeat' };
const MAG = { 9728: 'nearest', 9729: 'linear' };
// min filters fold mipmapFilter in; we treat anything mipmapped as linear/linear
const MIN = {
    9728: { min: 'nearest', mip: 'nearest' },
    9729: { min: 'linear', mip: 'nearest' },
    9984: { min: 'nearest', mip: 'nearest' },
    9985: { min: 'linear', mip: 'nearest' },
    9986: { min: 'nearest', mip: 'linear' },
    9987: { min: 'linear', mip: 'linear' },
};

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

// Loads a .gltf / .glb file into a Transform scene graph of Mesh nodes that
// render with the supplied PBR shader. Geometry is decoded onto the engine's
// Geometry/RenderPipeline/Mesh primitives; materials are mapped to texture maps
// + factor uniforms and bound alongside the shared IBL resources.
//
// Diverges from toji.dev's zero-copy bufferView upload: accessors are decoded to
// packed typed arrays so they flow through the existing Geometry abstraction, and
// because the engine writes per-mesh uniforms each draw, nodes are drawn as
// individual Mesh draws (each binding its own geometry + material bind group)
// sharing pipelines keyed by cull/blend state, rather than instanced through a
// transform storage buffer. The rest of
// the blog's guidance is followed: glb chunk parsing, accessor componentType ->
// format mapping, hierarchy traversal, per-material bind groups, sRGB-correct
// texture creation, sampler defaults, alphaMode -> pipeline state, and mipmaps.
export class GLTFLoader {
    constructor(
        gpu,
        {
            code,
            iblEntries = [],
            // override constants baked into the shader (e.g. roughnessLevels for
            // pbr.wgsl IBL specular lod) — forwarded to every primitive pipeline.
            constants = {},
            targets = null,
            sampleCount = 1,
            // parse geometry / skin / animation data only — skip building render
            // pipelines, materials and textures (no PBR shader / IBL required).
            // Useful when the geometry feeds something else, e.g. the VAT baker.
            dataOnly = false,
        } = {}
    ) {
        if (!gpu) throw new Error('GLTFLoader: no gpu context');
        if (!code && !dataOnly) throw new Error('GLTFLoader: no shader code provided');

        this.gpu = gpu;
        this.dataOnly = dataOnly;
        this.code = code;
        this.iblEntries = iblEntries;
        this.constants = constants;
        this.targets = targets;
        this.sampleCount = sampleCount;

        this.meshes = [];
        this.pipelines = [];
        this.skins = []; // parsed rigs (one per glTF skin)
        this.animations = []; // parsed animation channels (raw, resampled on demand)
        this.skinnedMeshes = []; // meshes carrying skin attributes
        this.staticMeshes = []; // dataOnly: decoded non-skinned primitives (raw attribute arrays)
        this._textureCache = new Map(); // image index -> GPUTexture
        // shared pipelines keyed by `cullMode|transparent` — every glTF primitive
        // has the same vertex layout (position/normal/uv/tangent), so the only
        // pipeline-state that varies per material is cull + blend. Reusing them
        // keeps a typical file to 1-2 pipelines instead of one per node.
        this._pipelineCache = new Map();
        this._defaults = null;
    }

    async load(url) {
        const lower = url.toLowerCase();
        const baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
        this._baseUrl = baseUrl;

        const buf = await (await fetch(url)).arrayBuffer();

        let json;
        let glbBinary = null;
        if (lower.endsWith('.glb')) {
            ({ json, binary: glbBinary } = parseGLB(buf));
        } else {
            json = JSON.parse(new TextDecoder().decode(buf));
        }

        this.json = json;

        // 1. buffers -> ArrayBuffers
        this.buffers = await Promise.all((json.buffers || []).map((b, i) => loadBuffer(b, baseUrl, glbBinary, i)));

        // 2. images -> GPU textures are resolved lazily per material (with sRGB hint)
        this.images = json.images || [];
        this.textures = json.textures || [];
        this.samplers = json.samplers || [];

        this._initDefaults();

        // 3. build node hierarchy
        const sceneIndex = json.scene ?? 0;
        const scene = json.scenes?.[sceneIndex] || { nodes: [] };

        // 3b. parse skins (rigs) + animations before nodes so meshes can attach
        this._buildSkins();
        this._buildAnimations();

        this.scene = new Transform();
        for (const nodeIndex of scene.nodes || []) {
            await this._buildNode(nodeIndex, this.scene);
        }

        return this.scene;
    }

    async _buildNode(index, parent) {
        const node = this.json.nodes[index];
        const transform = new Transform();
        transform.label = node.name || `node_${index}`;

        if (node.matrix) {
            transform.matrixAutoUpdate = false;
            transform.matrix = new Float32Array(node.matrix);
        } else {
            if (node.translation) transform.position = new Vec3(...node.translation);
            // .set (not reassign) keeps the Transform's rotation-sync onChange wired
            if (node.rotation) transform.quaternion.set(...node.rotation);
            if (node.scale) transform.scale = new Vec3(...node.scale);
        }

        transform.setParent(parent);

        if (node.mesh !== undefined) {
            await this._buildMesh(node.mesh, transform, node.skin);
        }

        for (const child of node.children || []) {
            await this._buildNode(child, transform);
        }
    }

    async _buildMesh(meshIndex, parent, skinIndex) {
        const mesh = this.json.meshes[meshIndex];
        for (const primitive of mesh.primitives) {
            const m = await this._buildPrimitive(primitive, mesh.name, skinIndex, parent);
            if (m) m.setParent(parent);
        }
    }

    async _buildPrimitive(primitive, name = 'gltf', skinIndex, parent) {
        const attrs = primitive.attributes;
        if (attrs.POSITION === undefined) return null;

        const position = this._readAttribute(attrs.POSITION);
        const indices = primitive.indices !== undefined ? this._readIndices(primitive.indices) : null;

        let normal = attrs.NORMAL !== undefined ? this._readAttribute(attrs.NORMAL) : null;
        if (!normal) normal = computeNormals(position, indices);

        const uv = attrs.TEXCOORD_0 !== undefined ? this._readAttribute(attrs.TEXCOORD_0) : new Float32Array((position.length / 3) * 2);

        // glTF TANGENT is vec4 (xyz + bitangent-sign w). Absent on many meshes;
        // the pbr shader falls back to a screen-space tangent frame when missing.
        const tangent = attrs.TANGENT !== undefined ? this._readAttribute(attrs.TANGENT) : null;

        // skinning attributes (JOINTS_0 = bone indices, WEIGHTS_0 = blend weights).
        // Joints index directly into skin.joints, which is our bone order, so no remap.
        const skinned = skinIndex !== undefined && attrs.JOINTS_0 !== undefined && attrs.WEIGHTS_0 !== undefined;
        const skinIndexData = skinned ? this._readJoints(attrs.JOINTS_0) : null;
        const skinWeightData = skinned ? this._readAttribute(attrs.WEIGHTS_0) : null;

        // data-only: collect arrays, skip all render-resource construction
        if (this.dataOnly) {
            if (skinned) {
                this.skinnedMeshes.push({
                    skinned: true,
                    skin: skinIndex,
                    skinAttributes: {
                        position,
                        normal,
                        uv,
                        indices,
                        skinIndex: skinIndexData,
                        skinWeight: skinWeightData,
                    },
                });
            } else {
                // static primitive: keep raw arrays + node transform + material so a
                // caller can build a Geometry and bolt on whatever pipeline it wants.
                // tangent kept as-is (null when absent) — getGeometry fills a placeholder.
                this.staticMeshes.push({
                    name,
                    node: parent, // Transform in the scene graph (local TRS already applied)
                    material: this.json.materials?.[primitive.material] || null,
                    hasTangents: tangent !== null,
                    attributes: { position, normal, uv, tangent, indices },
                });
            }
            return null;
        }

        const data = {
            position: { data: position, numComponents: 3 },
            normal: { data: normal, numComponents: 3 },
            uv: { data: uv, numComponents: 2 },
            // location 3: real tangents or a zero placeholder (pbr.wgsl always
            // declares the attribute; hasTangents below selects the code path).
            tangent: tangentAttribute(tangent, position.length / 3),
        };
        if (indices) data.indices = { data: indices };

        const geometry = new Geometry(this.gpu, { data });

        const material = this.json.materials?.[primitive.material] || {};
        const pbr = material.pbrMetallicRoughness || {};
        const alphaMode = material.alphaMode || 'OPAQUE';

        const cullMode = material.doubleSided ? 'none' : 'back';
        const transparent = alphaMode === 'BLEND';
        const pipeline = this._getPipeline(geometry, cullMode, transparent);

        const [baseColor, metalRough, normalMap, occlusion, emissive] = await Promise.all([
            this._materialTexture(pbr.baseColorTexture, true),
            this._materialTexture(pbr.metallicRoughnessTexture, false),
            this._materialTexture(material.normalTexture, false, 'normal'),
            this._materialTexture(material.occlusionTexture, false),
            this._materialTexture(material.emissiveTexture, true),
        ]);

        const iblEntries = this.iblEntries;
        const defaultSampler = this._defaults.sampler;

        // Material factors live in their own uniform block (binding 12), separate
        // from the per-draw Mesh uniforms. Written once here.
        const materialView = makeStructuredView(pipeline.defs.uniforms.material);
        materialView.set({
            baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
            emissiveFactor: material.emissiveFactor || [0, 0, 0],
            metallicFactor: pbr.metallicFactor ?? 1,
            roughnessFactor: pbr.roughnessFactor ?? 1,
            normalScale: material.normalTexture?.scale ?? 1,
            occlusionStrength: material.occlusionTexture?.strength ?? 1,
            alphaCutoff: material.alphaCutoff ?? 0.5,
            alphaMode: alphaMode === 'MASK' ? 1 : alphaMode === 'BLEND' ? 2 : 0,
            hasNormalMap: material.normalTexture ? 1 : 0,
            hasTangents: tangent ? 1 : 0,
            useGeometricNormal: 0,
        });
        const materialBuffer = createUniformBuffer(this.gpu, {
            label: `${name}-material-uniforms`,
            size: materialView.arrayBuffer.byteLength,
        });
        this.gpu.device.queue.writeBuffer(materialBuffer, 0, materialView.arrayBuffer);

        const m = new Mesh(this.gpu, {
            label: `${name}-mesh`,
            pipeline,
            geometry, // mesh owns the geometry; pipeline carries layout only
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: `${name}-material`,
                    layout: pipeline.bindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniformBuffer } },
                        ...iblEntries,
                        { binding: 5, resource: baseColor.createView() },
                        { binding: 6, resource: metalRough.createView() },
                        { binding: 7, resource: normalMap.createView() },
                        { binding: 8, resource: occlusion.createView() },
                        { binding: 9, resource: emissive.createView() },
                        { binding: 10, resource: defaultSampler },
                        { binding: 11, resource: this._defaults.white.createView() }, // opacity (fully opaque)
                        { binding: 12, resource: { buffer: materialBuffer } },
                    ],
                }),
            ],
        });

        if (skinned) {
            m.skinned = true;
            m.skin = skinIndex;
            // skinned positions come from the Skin compute pass, not the
            // bind-pose attribute — CPU bounds would be stale, so never cull
            m.frustumCulled = false;
            // raw attribute arrays for feeding @core/skin/Skin (see getSkinData)
            m.skinAttributes = {
                position,
                normal,
                uv,
                indices,
                skinIndex: skinIndexData,
                skinWeight: skinWeightData,
            };
            this.skinnedMeshes.push(m);
        }

        this.meshes.push(m);
        return m;
    }

    // One shared RenderPipeline per (cullMode, transparent) combo. All glTF
    // primitives carry the identical vertex layout, so a cache miss builds the
    // pipeline from the current geometry's layout and every later primitive with
    // the same state reuses it. `this.pipelines` holds the unique set.
    _getPipeline(geometry, cullMode, transparent) {
        const key = `${cullMode}|${transparent}`;
        let pipeline = this._pipelineCache.get(key);
        if (!pipeline) {
            pipeline = new RenderPipeline(this.gpu, {
                label: `gltf-${key}`,
                code: this.code,
                vertexBuffers: geometry.bufferLayouts,
                constants: this.constants,
                targets: this.targets,
                sampleCount: this.sampleCount,
                cullMode,
                transparent,
            });
            this._pipelineCache.set(key, pipeline);
            this.pipelines.push(pipeline);
        }
        return pipeline;
    }

    // ---- accessors ----

    _readAttribute(accessorIndex) {
        // vertex attributes are normalized to packed Float32 for the float vertex layout
        return readAccessor(this.json, this.buffers, accessorIndex, true);
    }

    _readIndices(accessorIndex) {
        const accessor = this.json.accessors[accessorIndex];
        const raw = readAccessor(this.json, this.buffers, accessorIndex, false);
        // WebGPU index buffers are uint16 or uint32 only; promote bytes to uint16
        if (accessor.componentType === 5125) return raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
        return raw instanceof Uint16Array ? raw : Uint16Array.from(raw);
    }

    // JOINTS_0 -> packed Uint32 bone indices (kept integer, not normalized to float)
    _readJoints(accessorIndex) {
        const raw = readAccessor(this.json, this.buffers, accessorIndex, false);
        return raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
    }

    // ---- skinning ----

    // Build a rig per glTF skin in the shape @core/skin/Skin expects:
    //   rig.bones              = [{ name, parent }]  (parent = index into bones, -1 for root)
    //   rig.bindPose           = { position, quaternion, scale }  (flat local TRS per bone)
    //   rig.skeletonAncestors  = the chain of non-joint ancestor nodes above the root joint
    //                            (e.g. a Blender armature, or Mixamo's "Neo_Reference" node),
    //                            ordered top -> leaf, with their bind-pose local TRS. The Skin
    //                            rebuilds these as ANIMATABLE transforms: Mixamo bakes root
    //                            motion onto this node rather than the hips, so freezing it
    //                            drops the translation/rotation of the whole character.
    // Bone order == skin.joints order, so JOINTS_0 indices map straight to bones.
    _buildSkins() {
        const skins = this.json.skins || [];

        // child node -> parent node (glTF only stores children)
        const parentOf = new Array(this.json.nodes.length).fill(-1);
        this.json.nodes.forEach((n, i) =>
            (n.children || []).forEach((c) => {
                parentOf[c] = i;
            })
        );

        this.skins = skins.map((skin) => {
            const joints = skin.joints;
            const nodeToBone = new Map();
            joints.forEach((nodeIdx, bone) => nodeToBone.set(nodeIdx, bone));

            const bones = [];
            const position = new Float32Array(joints.length * 3);
            const quaternion = new Float32Array(joints.length * 4);
            const scale = new Float32Array(joints.length * 3);

            joints.forEach((nodeIdx, bone) => {
                const node = this.json.nodes[nodeIdx];

                // parent bone = nearest ancestor node that is also a joint
                let p = parentOf[nodeIdx];
                let parentBone = -1;
                while (p !== -1) {
                    if (nodeToBone.has(p)) {
                        parentBone = nodeToBone.get(p);
                        break;
                    }
                    p = parentOf[p];
                }
                bones.push({ name: node.name || `bone_${bone}`, parent: parentBone });

                const { t, r, s } = localTRS(node);
                position.set(t, bone * 3);
                quaternion.set(r, bone * 4);
                scale.set(s, bone * 3);
            });

            // Non-joint ancestor nodes above the topmost joint (e.g. the Blender
            // armature object, or Mixamo's "Neo_Reference" node). Captured as an
            // ordered chain (top -> leaf) with their bind-pose local TRS so the Skin
            // can rebuild them as animatable transforms — root motion is frequently
            // authored on these nodes, not on the joints.
            const rootJointNode =
                joints.find((nd) => {
                    let p = parentOf[nd];
                    while (p !== -1) {
                        if (nodeToBone.has(p)) return false;
                        p = parentOf[p];
                    }
                    return true;
                }) ?? joints[0];

            const ancestorChain = [];
            let anc = parentOf[rootJointNode];
            while (anc !== -1) {
                ancestorChain.unshift(anc);
                anc = parentOf[anc];
            }

            const ac = ancestorChain.length;
            const nodeToAncestor = new Map();
            const skeletonAncestors = {
                count: ac,
                nodes: ancestorChain,
                name: ancestorChain.map((i) => this.json.nodes[i].name || `ancestor_${i}`),
                position: new Float32Array(ac * 3),
                quaternion: new Float32Array(ac * 4),
                scale: new Float32Array(ac * 3),
            };
            ancestorChain.forEach((nodeIdx, a) => {
                nodeToAncestor.set(nodeIdx, a);
                const { t, r, s } = localTRS(this.json.nodes[nodeIdx]);
                skeletonAncestors.position.set(t, a * 3);
                skeletonAncestors.quaternion.set(r, a * 4);
                skeletonAncestors.scale.set(s, a * 3);
            });

            // glTF inverseBindMatrices are the authoritative bind-inverse matrices
            // (written by the exporter at bind time). Use them directly so skin
            // matrices are exact even when the armature TRS decomposition differs.
            const inverseBindMatrices = skin.inverseBindMatrices !== undefined ? readAccessor(this.json, this.buffers, skin.inverseBindMatrices, true) : null;

            return {
                joints,
                nodeToBone,
                nodeToAncestor,
                rig: {
                    bones,
                    bindPose: { position, quaternion, scale },
                    skeletonAncestors,
                    inverseBindMatrices,
                },
            };
        });
    }

    // Parse animation channels once (sampler keyframes decoded to float). Frames
    // are resampled to a uniform rate on demand in getAnimation().
    _buildAnimations() {
        const anims = this.json.animations || [];
        this.animations = anims.map((anim, ai) => {
            let duration = 0;
            const channels = anim.channels.map((ch) => {
                const sampler = anim.samplers[ch.sampler];
                const times = readAccessor(this.json, this.buffers, sampler.input, true);
                const values = readAccessor(this.json, this.buffers, sampler.output, true);
                duration = Math.max(duration, times[times.length - 1] || 0);
                return {
                    node: ch.target.node,
                    path: ch.target.path, // translation | rotation | scale
                    interp: sampler.interpolation || 'LINEAR', // LINEAR | STEP | CUBICSPLINE
                    times,
                    values,
                };
            });
            return { name: anim.name || `anim_${ai}`, duration, channels };
        });
    }

    // Skin data object ready for `new Skin(gpu, { data })`. Accepts a skinned Mesh
    // (from this.skinnedMeshes) or its index.
    getSkinData(meshOrIndex = 0) {
        const m = typeof meshOrIndex === 'number' ? this.skinnedMeshes[meshOrIndex] : meshOrIndex;
        if (!m || !m.skinned) {
            console.error('GLTFLoader.getSkinData: not a skinned mesh');
            return null;
        }
        const sk = this.skins[m.skin];
        return {
            position: m.skinAttributes.position,
            normal: m.skinAttributes.normal,
            uv: m.skinAttributes.uv,
            indices: m.skinAttributes.indices,
            skinIndex: m.skinAttributes.skinIndex,
            skinWeight: m.skinAttributes.skinWeight,
            rig: sk.rig,
        };
    }

    // dataOnly: raw attribute arrays for a decoded static primitive (or its index).
    // { name, node, material, position, normal, uv, indices } — feed straight into
    // `new Geometry(gpu, { data })` or use getGeometry() below.
    getGeometryData(meshOrIndex = 0) {
        const s = typeof meshOrIndex === 'number' ? this.staticMeshes[meshOrIndex] : meshOrIndex;
        if (!s) {
            console.error('GLTFLoader.getGeometryData: no static mesh at', meshOrIndex);
            return null;
        }
        return {
            name: s.name,
            node: s.node,
            material: s.material,
            hasTangents: s.hasTangents, // true only when the glTF carried real tangents
            position: s.attributes.position,
            normal: s.attributes.normal,
            uv: s.attributes.uv,
            tangent: s.attributes.tangent, // vec4 (xyz + sign) or null
            indices: s.attributes.indices,
        };
    }

    // dataOnly convenience: build an engine Geometry from a decoded static primitive,
    // ready to hand to a RenderPipeline of the caller's choosing. Always includes a
    // vec4 tangent attribute (zero placeholder when the glTF lacked tangents) so it
    // drops straight into the pbr shader; `geometry.hasTangents` reflects whether the
    // tangents are real (drive the matching `hasTangents` shader uniform from it).
    getGeometry(meshOrIndex = 0) {
        const d = this.getGeometryData(meshOrIndex);
        if (!d) return null;
        const data = {
            position: { data: d.position, numComponents: 3 },
            normal: { data: d.normal, numComponents: 3 },
            uv: { data: d.uv, numComponents: 2 },
            tangent: tangentAttribute(d.tangent, d.position.length / 3),
        };
        if (d.indices) data.indices = { data: d.indices };
        const geometry = new Geometry(this.gpu, { data });
        geometry.hasTangents = d.hasTangents;
        return geometry;
    }

    // Resample an animation to uniform frames for `new Animation({ data })`.
    // Returns { label, frames:[{ position, quaternion, scale }] } laid out as
    // [skeletonAncestors..., joints...] — the exact order of Skin.poseTransforms,
    // so the Animation drives the non-joint root node(s) plus every bone. (Root
    // motion baked onto an ancestor node — common in Mixamo — would be lost if only
    // joint channels were resampled.)
    getAnimation({ animation = 0, skin = 0, fps = 30 } = {}) {
        const anim = this.animations[animation];
        const sk = this.skins[skin];
        if (!anim || !sk) {
            console.error('GLTFLoader.getAnimation: bad animation/skin index');
            return null;
        }

        const bp = sk.rig.bindPose;
        const sa = sk.rig.skeletonAncestors || { count: 0 };
        const ac = sa.count;
        const targetCount = ac + sk.rig.bones.length;
        const frameCount = Math.max(2, Math.round(anim.duration * fps) + 1);

        // node -> index into the pose-transform list (ancestors first, then joints)
        const nodeToPose = new Map();
        if (ac) sa.nodes.forEach((nd, a) => nodeToPose.set(nd, a));
        sk.nodeToBone.forEach((bone, nd) => nodeToPose.set(nd, ac + bone));

        const chans = anim.channels.map((c) => ({ ...c, target: nodeToPose.get(c.node) })).filter((c) => c.target !== undefined);

        if (chans.length === 0) {
            const sampleNodes = anim.channels.slice(0, 3).map((c) => c.node);
            const targetNodes = [...nodeToPose.keys()].slice(0, 3);
            console.warn('[getAnimation] no channels match skin — anim nodes:', sampleNodes, 'target nodes:', targetNodes);
        }

        // bind-pose base for every target: ancestors' bind TRS, then the joints'
        const baseP = new Float32Array(targetCount * 3);
        const baseQ = new Float32Array(targetCount * 4);
        const baseS = new Float32Array(targetCount * 3);
        if (ac) {
            baseP.set(sa.position, 0);
            baseQ.set(sa.quaternion, 0);
            baseS.set(sa.scale, 0);
        }
        baseP.set(bp.position, ac * 3);
        baseQ.set(bp.quaternion, ac * 4);
        baseS.set(bp.scale, ac * 3);

        const frames = [];
        for (let f = 0; f < frameCount; f++) {
            const t = Math.min(anim.duration, f / fps);
            // start from the bind pose, then overwrite animated channels
            const position = new Float32Array(baseP);
            const quaternion = new Float32Array(baseQ);
            const scale = new Float32Array(baseS);

            for (const c of chans) {
                if (c.path === 'translation') position.set(sampleVec(c, t, 3), c.target * 3);
                else if (c.path === 'scale') scale.set(sampleVec(c, t, 3), c.target * 3);
                else if (c.path === 'rotation') quaternion.set(sampleQuat(c, t), c.target * 4);
            }

            frames.push({ position, quaternion, scale });
        }

        return { label: anim.name, frames };
    }

    // Decode one material map to an engine Texture. Works in dataOnly (images,
    // buffers and defaults are all set in load()). Returns null when the material
    // lacks that map. map: baseColor | metallicRoughness | normal | occlusion | emissive.
    async getMaterialTexture(materialIndex = 0, map = 'baseColor') {
        const material = this.json.materials?.[materialIndex];
        if (!material) return null;
        const pbr = material.pbrMetallicRoughness || {};
        const info = {
            baseColor: pbr.baseColorTexture,
            metallicRoughness: pbr.metallicRoughnessTexture,
            normal: material.normalTexture,
            occlusion: material.occlusionTexture,
            emissive: material.emissiveTexture,
        }[map];
        if (!info || info.index === undefined) return null;
        const srgb = map === 'baseColor' || map === 'emissive';
        return this._decodeImage(this._imageIndex(info.index), srgb);
    }

    // glTF texture -> image index. EXT_texture_webp/avif store source under the
    // extension instead of the top-level field.
    _imageIndex(textureIndex) {
        const tex = this.textures[textureIndex];
        return tex.source ?? tex.extensions?.EXT_texture_webp?.source ?? tex.extensions?.EXT_texture_avif?.source;
    }

    // ---- textures ----

    _initDefaults() {
        const white = this._solidTexture([255, 255, 255, 255], true); // baseColor / emissive (sRGB)
        const whiteLin = this._solidTexture([255, 255, 255, 255], false); // metalRough / occlusion
        const black = this._solidTexture([0, 0, 0, 255], false); // normal slot when absent (hasNormalMap = 0)

        this._defaults = {
            white,
            whiteLin,
            black,
            sampler: this.gpu.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'repeat',
                addressModeV: 'repeat',
            }),
        };
    }

    // 2x2 solid fallback. Used when a material lacks the map; the shader still
    // multiplies by the material factors, so white here = factor-only output
    // (metallic/roughness/AO come straight from metallicFactor/roughnessFactor/
    // occlusionStrength).
    _solidTexture([r, g, b, a], srgb) {
        const size = 2;
        const pixels = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) pixels.set([r, g, b, a], i * 4);
        return new Texture(this.gpu, {
            label: 'gltf-solid',
            width: size,
            height: size,
            data: pixels,
            format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        });
    }

    // textureInfo: { index, texCoord } from the material. kind selects the fallback.
    // Returns a Promise<GPUTexture>; decoding is deduped per (image, colorSpace).
    _materialTexture(textureInfo, srgb, kind = 'white') {
        if (!textureInfo || textureInfo.index === undefined) {
            return Promise.resolve(kind === 'normal' ? this._defaults.black : srgb ? this._defaults.white : this._defaults.whiteLin);
        }
        const imageIndex = this._imageIndex(textureInfo.index);
        const cacheKey = `${imageIndex}:${srgb ? 1 : 0}`;
        if (!this._textureCache.has(cacheKey)) {
            this._textureCache.set(cacheKey, this._decodeImage(imageIndex, srgb));
        }
        return this._textureCache.get(cacheKey);
    }

    async _decodeImage(imageIndex, srgb) {
        const image = this.images[imageIndex];
        let blob;
        if (image.uri !== undefined) {
            blob = await (await fetch(resolveUri(image.uri, this._baseUrl))).blob();
        } else {
            const view = this.json.bufferViews[image.bufferView];
            const buffer = this.buffers[view.buffer];
            const start = view.byteOffset || 0;
            const slice = buffer.slice(start, start + view.byteLength);
            blob = new Blob([slice], { type: image.mimeType || 'image/png' });
        }

        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        const tex = new Texture(this.gpu, {
            label: 'gltf-image',
            src: bitmap,
            mips: true,
            flipY: false,
            format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        });
        await tex.ready;
        return tex;
    }
}

// ---- module helpers ----

// Geometry attribute descriptor for the vec4 tangent buffer. Real tangents pass
// straight through; when absent a zero-filled placeholder keeps the vertex layout
// stable (location 3 always present) so a single pbr pipeline serves both — the
// shader's hasTangents uniform, not the buffer, decides whether they're used.
function tangentAttribute(tangent, vertexCount) {
    return { data: tangent || new Float32Array(vertexCount * 4), numComponents: 4 };
}

// local TRS of a node (decomposing node.matrix if present, else TRS fields)
function localTRS(node) {
    if (node.matrix) {
        const m = new Mat4().copy(node.matrix);
        const t = m.getTranslation(new Vec3());
        const s = m.getScale(new Vec3());
        const r = m.getRotation(new Quat());
        return { t: Array.from(t), r: Array.from(r), s: Array.from(s) };
    }
    return {
        t: node.translation || [0, 0, 0],
        r: node.rotation || [0, 0, 0, 1],
        s: node.scale || [1, 1, 1],
    };
}

// locate the keyframe segment [i0, i1] bracketing t and the 0..1 blend between them
function findSeg(times, t) {
    const n = times.length;
    if (n === 0) return [0, 0, 0];
    if (t <= times[0]) return [0, 0, 0];
    if (t >= times[n - 1]) return [n - 1, n - 1, 0];
    let i = 0;
    while (i < n - 1 && times[i + 1] < t) i++;
    const span = times[i + 1] - times[i];
    const a = span > 0 ? (t - times[i]) / span : 0;
    return [i, i + 1, a];
}

// CUBICSPLINE packs [inTangent, value, outTangent] per key; take the value, drop
// tangents (linear fallback). STEP holds the lower key; LINEAR lerps.
function sampleVec(c, t, stride) {
    const cubic = c.interp === 'CUBICSPLINE';
    const per = cubic ? stride * 3 : stride;
    const valAt = (k) => {
        const base = k * per + (cubic ? stride : 0);
        return c.values.subarray(base, base + stride);
    };

    const [i0, i1, a] = findSeg(c.times, t);
    const v0 = valAt(i0);
    if (c.interp === 'STEP' || i0 === i1) return Array.from(v0);

    const v1 = valAt(i1);
    const out = new Array(stride);
    for (let k = 0; k < stride; k++) out[k] = v0[k] + (v1[k] - v0[k]) * a;
    return out;
}

function sampleQuat(c, t) {
    const cubic = c.interp === 'CUBICSPLINE';
    const per = cubic ? 12 : 4;
    const valAt = (k) => {
        const b = k * per + (cubic ? 4 : 0);
        return new Quat(c.values[b], c.values[b + 1], c.values[b + 2], c.values[b + 3]);
    };

    const [i0, i1, a] = findSeg(c.times, t);
    const q0 = valAt(i0);
    if (c.interp === 'STEP' || i0 === i1) return Array.from(q0);

    const q1 = valAt(i1);
    return Array.from(q0.clone().slerp(q1, a));
}

function parseGLB(buf) {
    const view = new DataView(buf);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('parseGLB: bad magic');

    let offset = 12; // skip magic, version, length
    let json = null;
    let binary = null;

    while (offset < buf.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkStart = offset + 8;

        if (chunkType === CHUNK_JSON) {
            json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, chunkStart, chunkLength)));
        } else if (chunkType === CHUNK_BIN) {
            binary = buf.slice(chunkStart, chunkStart + chunkLength);
        }
        offset = chunkStart + chunkLength;
    }

    if (!json) throw new Error('parseGLB: no JSON chunk');
    return { json, binary };
}

async function loadBuffer(bufferDef, baseUrl, glbBinary, index) {
    if (bufferDef.uri === undefined) {
        if (!glbBinary) throw new Error(`buffer ${index} has no uri and no glb binary chunk`);
        return glbBinary;
    }
    if (bufferDef.uri.startsWith('data:')) {
        return decodeDataUri(bufferDef.uri);
    }
    return (await fetch(baseUrl + bufferDef.uri)).arrayBuffer();
}

function decodeDataUri(uri) {
    const base64 = uri.slice(uri.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function resolveUri(uri, baseUrl) {
    if (uri.startsWith('data:')) return uri;
    return (baseUrl || '') + uri;
}

// Decodes an accessor into a packed (deinterleaved) typed array. When toFloat is
// set, integer attributes are converted to Float32 (normalizing if flagged) so
// they match the engine's float vertex layout.
function readAccessor(json, buffers, accessorIndex, toFloat) {
    const accessor = json.accessors[accessorIndex];
    const comp = COMPONENT[accessor.componentType];
    const numComponents = TYPE_COMPONENTS[accessor.type];
    const count = accessor.count;
    const total = count * numComponents;

    const view = json.bufferViews[accessor.bufferView];
    const buffer = buffers[view.buffer];
    const byteStride = view.byteStride || comp.size * numComponents;
    const baseOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);

    const src = new DataView(buffer);
    const reader = dataViewReader(src, accessor.componentType);

    const Out = toFloat ? Float32Array : comp.array;
    const out = new Out(total);

    for (let i = 0; i < count; i++) {
        const elementOffset = baseOffset + i * byteStride;
        for (let c = 0; c < numComponents; c++) {
            let v = reader(elementOffset + c * comp.size);
            if (toFloat && accessor.normalized) v = normalize(v, accessor.componentType);
            out[i * numComponents + c] = v;
        }
    }

    return out;
}

function dataViewReader(view, componentType) {
    switch (componentType) {
        case 5120:
            return (o) => view.getInt8(o);
        case 5121:
            return (o) => view.getUint8(o);
        case 5122:
            return (o) => view.getInt16(o, true);
        case 5123:
            return (o) => view.getUint16(o, true);
        case 5125:
            return (o) => view.getUint32(o, true);
        case 5126:
            return (o) => view.getFloat32(o, true);
        default:
            throw new Error(`unknown componentType ${componentType}`);
    }
}

function normalize(v, componentType) {
    switch (componentType) {
        case 5120:
            return Math.max(v / 127, -1);
        case 5121:
            return v / 255;
        case 5122:
            return Math.max(v / 32767, -1);
        case 5123:
            return v / 65535;
        default:
            return v;
    }
}

function computeNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    const triCount = indices ? indices.length / 3 : positions.length / 9;

    for (let t = 0; t < triCount; t++) {
        const a = indices ? indices[t * 3] : t * 3;
        const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
        const c = indices ? indices[t * 3 + 2] : t * 3 + 2;

        const ax = positions[a * 3],
            ay = positions[a * 3 + 1],
            az = positions[a * 3 + 2];
        const bx = positions[b * 3],
            by = positions[b * 3 + 1],
            bz = positions[b * 3 + 2];
        const cx = positions[c * 3],
            cy = positions[c * 3 + 1],
            cz = positions[c * 3 + 2];

        const e1x = bx - ax,
            e1y = by - ay,
            e1z = bz - az;
        const e2x = cx - ax,
            e2y = cy - ay,
            e2z = cz - az;

        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;

        for (const idx of [a, b, c]) {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
        }
    }

    for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i],
            y = normals[i + 1],
            z = normals[i + 2];
        const len = Math.hypot(x, y, z) || 1;
        normals[i] = x / len;
        normals[i + 1] = y / len;
        normals[i + 2] = z / len;
    }

    return normals;
}
