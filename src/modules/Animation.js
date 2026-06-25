import { Vec3, Quat } from '@math';

const currentPos = new Vec3();
const nextPos = new Vec3();

const currentQuat = new Quat();
const nextQuat = new Quat();

const currentScale = new Vec3();
const nextScale = new Vec3();

export class Animation {
    constructor({ transforms = [], label = 'animation', data = [], loop = true } = {}) {
        this.label = label;
        this.data = data;

        this.transforms = transforms;
        this.loop = loop;
        this.elapsed = 0;
        this._fps = null;
        // frame count: elapsed is measured in frames, the cycle wraps over all of
        // them (frame N == frame 0). Using length-1 here dropped the last frame.
        this.duration = this.data.frames.length;
        this.weight = 1;
    }

    // set (chainable) or get fps. Required before the animation is advanced.
    fps(value) {
        if (value === undefined) {
            if (this._fps === null) throw new Error(`Animation "${this.label}": fps not set — call animation.fps(n)`);
            return this._fps;
        }
        this._fps = value;
        return this;
    }

    //TODO: blend weighting
    update(totalWeight = 1, isSet = false) {
        const n = this.data.frames.length;
        const weight = isSet ? 1.0 : this.weight / totalWeight;

        // wrap (or clamp) before indexing so frame stays in range. The VAT baker
        // drives elapsed to exact integers 0..n-1, which survive the modulo intact.
        if (this.loop) this.elapsed %= this.duration;
        else this.elapsed = Math.min(this.elapsed, n - 1);

        const frame = Math.floor(this.elapsed);
        const blend = this.elapsed - frame;

        const currentKeyFrame = this.data.frames[frame];
        const nextKeyFrame = this.data.frames[(frame + 1) % n];

        this.transforms.forEach((transform, i) => {
            const currentPosX = currentKeyFrame.position[i * 3];
            const currentPosY = currentKeyFrame.position[i * 3 + 1];
            const currentPosZ = currentKeyFrame.position[i * 3 + 2];
            currentPos.set(currentPosX, currentPosY, currentPosZ);

            const nextPosX = nextKeyFrame.position[i * 3];
            const nextPosY = nextKeyFrame.position[i * 3 + 1];
            const nextPosZ = nextKeyFrame.position[i * 3 + 2];
            nextPos.set(nextPosX, nextPosY, nextPosZ);

            currentPos.lerp(nextPos, blend);

            const currentQuatX = currentKeyFrame.quaternion[i * 4];
            const currentQuatY = currentKeyFrame.quaternion[i * 4 + 1];
            const currentQuatZ = currentKeyFrame.quaternion[i * 4 + 2];
            const currentQuatW = currentKeyFrame.quaternion[i * 4 + 3];
            currentQuat.set(currentQuatX, currentQuatY, currentQuatZ, currentQuatW);

            const nextQuatX = nextKeyFrame.quaternion[i * 4];
            const nextQuatY = nextKeyFrame.quaternion[i * 4 + 1];
            const nextQuatZ = nextKeyFrame.quaternion[i * 4 + 2];
            const nextQuatW = nextKeyFrame.quaternion[i * 4 + 3];
            nextQuat.set(nextQuatX, nextQuatY, nextQuatZ, nextQuatW);

            currentQuat.slerp(nextQuat, blend);

            const currentScaleX = currentKeyFrame.scale[i * 3];
            const currentScaleY = currentKeyFrame.scale[i * 3 + 1];
            const currentScaleZ = currentKeyFrame.scale[i * 3 + 2];
            currentScale.set(currentScaleX, currentScaleY, currentScaleZ);

            const nextScaleX = nextKeyFrame.scale[i * 3];
            const nextScaleY = nextKeyFrame.scale[i * 3 + 1];
            const nextScaleZ = nextKeyFrame.scale[i * 3 + 2];
            nextScale.set(nextScaleX, nextScaleY, nextScaleZ);

            currentScale.lerp(nextScale, blend);

            transform.position.lerp(currentPos, weight);
            transform.quaternion.slerp(currentQuat, weight);
            transform.scale.lerp(currentScale, weight);
        });
    }
}
