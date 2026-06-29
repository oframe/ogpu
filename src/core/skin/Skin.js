// GPU skinning: compute pass writes skinned position/normal storage buffers
// the render pipeline reads.
// Ref: https://toji.dev/webgpu-best-practices/compute-vertex-data

import { Vec3, Quat, Mat4 } from '@math';
import { createStorageBuffer } from '@utils/BufferUtils';
import { ComputeShader } from '@core/ComputeShader';
import { Transform } from '@core/Transform';
import skin from './skin.wgsl?raw';

const _rootInverse = /* @__PURE__ */ new Mat4();

export class Skin {
    constructor(gpu, { label = 'skin', data } = {}) {
        this.gpu = gpu;
        this.label = label;

        this.animations = new Map();

        this.geometry = {
            position: data.position,
            normal: data.normal,
            weight: data.skinWeight,
            boneIndex: data.skinIndex,
        };

        this.rig = data.rig;

        this.tmpMatrix = new Mat4();

        this.initBones();
        this.initSkinning();
    }

    initBones() {
        this.root = new Transform();

        // Rebuild the rig's non-joint ancestor nodes (e.g. a Blender armature, or
        // Mixamo's "Neo_Reference" node) as an ANIMATABLE chain of transforms between
        // this.root and the root bones (top -> leaf). This puts bind-inverse and
        // current-pose in the same space as the mesh vertices, AND lets the animation
        // drive them — root motion is often baked onto an ancestor node rather than
        // the hips, so a frozen skeleton root would drop it. Flat / hand-built rigs
        // have no ancestors and skip this entirely.
        this.skeletonBones = [];
        const ancestors = this.rig.skeletonAncestors;
        if (ancestors && ancestors.count) {
            let parentTransform = this.root;
            for (let a = 0; a < ancestors.count; a++) {
                const t = new Transform();
                t.label = ancestors.name[a];
                t.position = new Vec3(ancestors.position[a * 3], ancestors.position[a * 3 + 1], ancestors.position[a * 3 + 2]);
                t.quaternion = new Quat(ancestors.quaternion[a * 4], ancestors.quaternion[a * 4 + 1], ancestors.quaternion[a * 4 + 2], ancestors.quaternion[a * 4 + 3]);
                t.scale = new Vec3(ancestors.scale[a * 3], ancestors.scale[a * 3 + 1], ancestors.scale[a * 3 + 2]);
                t.setParent(parentTransform);
                this.skeletonBones.push(t);
                parentTransform = t;
            }
            // leaf ancestor = parent of the root joints
            this.skeletonRoot = this.skeletonBones[this.skeletonBones.length - 1];
        }

        this.bones = [];

        const boneMatrixBufferSize = this.rig.bones.length * 16 * 4;

        this.invBoneMatrixBuffer = createStorageBuffer(this.gpu, {
            label: `${this.label}-bind-pose-buffer`,
            size: boneMatrixBufferSize,
        });

        const bindPose = this.rig.bindPose;
        const bindPoseData = new Float32Array(this.rig.bones.length * 16);
        for (let i = 0; i < this.rig.bones.length; i++) {
            const bone = new Transform();

            const bindPosePosition = new Vec3(bindPose.position[i * 3], bindPose.position[i * 3 + 1], bindPose.position[i * 3 + 2]);
            const bindPoseQuaternion = new Quat(bindPose.quaternion[i * 4], bindPose.quaternion[i * 4 + 1], bindPose.quaternion[i * 4 + 2], bindPose.quaternion[i * 4 + 3]);
            const bindPoseScale = new Vec3(bindPose.scale[i * 3], bindPose.scale[i * 3 + 1], bindPose.scale[i * 3 + 2]);
            bone.position = bindPosePosition;
            bone.quaternion = bindPoseQuaternion;
            bone.scale = bindPoseScale;

            this.bones.push(bone);
        }

        this.rig.bones.forEach((bone, i) => {
            this.bones[i].label = bone?.label || bone?.name || `bone_${i}`;
            if (bone.parent === -1) return this.bones[i].setParent(this.skeletonRoot || this.root);
            this.bones[i].setParent(this.bones[bone.parent]);
        });

        // Transforms an Animation drives, in the same order GLTFLoader.getAnimation
        // lays out its frames: non-joint ancestors first, then the joints.
        this.poseTransforms = [...this.skeletonBones, ...this.bones];

        this.root.updateMatrixWorld(true);

        if (this.rig.inverseBindMatrices) {
            // Authoritative bind-inverse matrices from the glTF file.
            // These are precomputed by the exporter and include all ancestor
            // transforms (armature scale/rotation, etc.) exactly as intended.
            this.gpu.device.queue.writeBuffer(this.invBoneMatrixBuffer, 0, this.rig.inverseBindMatrices);
        } else {
            // FK-derived bind-inverse for hand-built rigs without glTF source.
            const rootInverse = new Mat4().copy(this.root.worldMatrix).invert();
            this.bones.forEach((bone, i) => {
                bone.bindInverseMatrix = new Mat4().copy(rootInverse).multiply(bone.worldMatrix).invert();
                bindPoseData.set(bone.bindInverseMatrix, i * 16);
            });
            this.gpu.device.queue.writeBuffer(this.invBoneMatrixBuffer, 0, bindPoseData);
        }

        this.boneMatrixData = new Float32Array(this.rig.bones.length * 16);

        this.boneMatrixBuffer = createStorageBuffer(this.gpu, {
            label: `${this.label}-bone-buffer`,
            size: boneMatrixBufferSize,
        });
    }

    createGeometryBuffer(name, size, data) {
        const buffer = createStorageBuffer(this.gpu, {
            label: `${this.label}-${name}-buffer`,
            size,
        });
        this.gpu.device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }

    initSkinning() {
        const { position, normal, weight, boneIndex } = this.geometry;

        this.threadCount = position.length / 3;
        const positionData = new Float32Array(position);
        const normalData = new Float32Array(normal);
        const weightData = new Float32Array(weight);
        const boneIndexData = new Uint32Array(boneIndex);

        this.positionBuffer = this.createGeometryBuffer('position', positionData.byteLength, positionData);
        this.normalBuffer = this.createGeometryBuffer('normal', normalData.byteLength, normalData);
        this.weightBuffer = this.createGeometryBuffer('weight', weightData.byteLength, weightData);
        this.boneIndexBuffer = this.createGeometryBuffer('boneIndex', boneIndexData.byteLength, boneIndexData);

        this.skinnedPositionBuffer = createStorageBuffer(this.gpu, {
            label: `${this.label}-skinned-position-buffer`,
            size: positionData.byteLength,
        });

        this.skinnedNormalBuffer = createStorageBuffer(this.gpu, {
            label: `${this.label}-skinned-normal-buffer`,
            size: normalData.byteLength,
        });

        this.skinner = new ComputeShader(this.gpu, {
            label: `${this.label}-skinner`,
            code: skin,
        });

        this.skinningBindGroup = this.gpu.device.createBindGroup({
            label: `${this.label}-skinning-bind-group`,
            layout: this.skinner.bindGroupLayout(this.skinner.findKernel('skin')),
            entries: [
                { binding: 0, resource: { buffer: this.positionBuffer } },
                { binding: 1, resource: { buffer: this.normalBuffer } },
                { binding: 2, resource: { buffer: this.weightBuffer } },
                { binding: 3, resource: { buffer: this.boneIndexBuffer } },

                { binding: 4, resource: { buffer: this.invBoneMatrixBuffer } },
                { binding: 5, resource: { buffer: this.boneMatrixBuffer } },

                { binding: 6, resource: { buffer: this.skinnedPositionBuffer } },
                { binding: 7, resource: { buffer: this.skinnedNormalBuffer } },
            ],
        });
    }

    addAnimation(animation) {
        this.animations.set(animation.label, animation);
    }

    getAnimation(label) {
        return this.animations.get(label);
    }

    // advance every registered animation, blending by weight
    applyAnimations() {
        let totalWeight = 0;
        let i = 0;
        // Map.forEach yields (value, key) — track the index ourselves so the first
        // animation is forced to set (resets the accumulated pose).
        this.animations.forEach((animation) => {
            totalWeight += animation.weight;
            animation.update(totalWeight, i === 0);
            i++;
        });
    }

    // recompute world matrices from the current bone pose and upload them to the
    // bone matrix buffer. Caller is responsible for having posed the bones first
    // (applyAnimations, or driving an Animation directly).
    updateBones() {
        this.root.updateMatrixWorld(true);
        // Same root-relative space as the bind matrices (see initBones). This
        // cancels root.worldMatrix — which includes the root's scene-graph
        // ancestors (the mesh transform) — so it never doubles into the skin.
        _rootInverse.copy(this.root.worldMatrix).invert();
        this.bones.forEach((bone, i) => {
            // current root-relative pose; skin.wgsl multiplies by the bind inverse
            this.tmpMatrix.copy(_rootInverse).multiply(bone.worldMatrix);
            this.boneMatrixData.set(this.tmpMatrix, i * 16);
        });
        this.gpu.device.queue.writeBuffer(this.boneMatrixBuffer, 0, this.boneMatrixData);
    }

    // Full per-frame skin: blend animations -> push bone matrices -> dispatch the
    // skinning compute. The two halves are public for callers that pose manually.
    update(dt = 0) {
        this.applyAnimations();
        this.updateBones();

        const encoder = this.gpu.device.createCommandEncoder({ label: 'skinning-encoder' });

        this.skinner.dispatch(encoder, {
            kernel: this.skinner.findKernel('skin'),
            bindGroup: this.skinningBindGroup,
            dispatchCount: [Math.ceil(this.threadCount / 64), 1, 1],
        });

        const commandBuffer = encoder.finish();
        this.gpu.device.queue.submit([commandBuffer]);
    }
}
