import { Vec3, Quat, Mat4, Euler } from '@math';

const _aim = /* @__PURE__ */ new Mat4();

// Scene-graph node: local TRS + matrix/worldMatrix, parent/children. Base of everything renderable.
export class Transform {
    constructor() {
        this.parent = null;
        this.children = [];
        this.visible = true;
        // { x, y, width, height } in attachment pixels (device px on the canvas,
        // texels on a RenderTarget), origin top-left. Intersected with every
        // ancestor's; a draw clipped to nothing is skipped. See Renderer.resolveScissor.
        this.scissor = null;

        this.matrix = new Mat4();
        this.worldMatrix = new Mat4();

        this.matrixAutoUpdate = true;
        this.worldMatrixNeedsUpdate = false;
        // bumped whenever worldMatrix is recomputed — the only place it's written;
        // Mesh caches normalMatrix/objectMatrix against it
        this.worldVersion = 0;
        // bumped on this node and every ancestor when a child is added or
        // removed anywhere below — RecordedGroup.stale compares it
        this.structureVersion = 0;
        // last composed position/quaternion/scale — updateMatrix skips the compose
        // (and the world multiply it would trigger) when unchanged. NaN seeds
        // guarantee the first compose.
        this._trs = new Float32Array(10).fill(NaN);

        this.position = new Vec3(0, 0, 0);
        this.quaternion = new Quat(0, 0, 0, 1);
        this.scale = new Vec3(1, 1, 1);
        this.up = new Vec3(0, 1, 0);

        // Two-way Euler proxy: set `rotation.x/y/z` and the quaternion
        // follows; mutate the quaternion (lookAt, animation, rotateX…) and
        // `rotation` follows. The cross-sync setters don't re-fire, so no loop.
        this.rotation = new Euler();
        this.rotation.onChange = () => this.quaternion.setFromEuler(this.rotation.x, this.rotation.y, this.rotation.z, this.rotation.order.toLowerCase());
        this.quaternion.onChange = () => this.rotation.setFromQuaternion(this.quaternion);
    }

    setParent(parent, notifyParent = true) {
        if (this.parent && parent !== this.parent) this.parent.removeChild(this, false);
        this.parent = parent;
        // unchanged TRS no longer re-dirties the world matrix — a new parent must
        this.worldMatrixNeedsUpdate = true;
        if (notifyParent && parent) parent.addChild(this, false);
    }

    addChild(child, notifyChild = true) {
        if (!~this.children.indexOf(child)) {
            this.children.push(child);
            this._structureChanged();
        }
        if (notifyChild) child.setParent(this, false);
    }

    removeChild(child, notifyChild = true) {
        const i = this.children.indexOf(child);
        if (~i) {
            this.children.splice(i, 1);
            this._structureChanged();
        }
        if (notifyChild) child.setParent(null, false);
    }

    _structureChanged() {
        for (let node = this; node; node = node.parent) node.structureVersion++;
    }

    updateMatrixWorld(force) {
        if (this.matrixAutoUpdate) this.updateMatrix();
        if (this.worldMatrixNeedsUpdate || force) {
            if (this.parent === null) this.worldMatrix.copy(this.matrix);
            else this.worldMatrix.copy(this.parent.worldMatrix).multiply(this.matrix);
            this.worldMatrixNeedsUpdate = false;
            this.worldVersion++;
            force = true;
        }

        for (let i = 0, l = this.children.length; i < l; i++) {
            this.children[i].updateMatrixWorld(force);
        }
    }

    // Recompose only when TRS changed. A direct write to `matrix` on an
    // auto-updating node therefore persists until TRS next changes.
    updateMatrix() {
        const p = this.position;
        const q = this.quaternion;
        const s = this.scale;
        const c = this._trs;
        if (c[0] === p[0] && c[1] === p[1] && c[2] === p[2] && c[3] === q[0] && c[4] === q[1] && c[5] === q[2] && c[6] === q[3] && c[7] === s[0] && c[8] === s[1] && c[9] === s[2]) return;
        c[0] = p[0];
        c[1] = p[1];
        c[2] = p[2];
        c[3] = q[0];
        c[4] = q[1];
        c[5] = q[2];
        c[6] = q[3];
        c[7] = s[0];
        c[8] = s[1];
        c[9] = s[2];
        this.matrix.compose(p, q, s);
        this.worldMatrixNeedsUpdate = true;
    }

    traverse(callback) {
        // Return true in callback to stop traversing children
        if (callback(this)) return;
        for (let i = 0, l = this.children.length; i < l; i++) {
            this.children[i].traverse(callback);
        }
    }

    // Aim +Z at `target`. invert=true swaps eye/target (point `this` AT target).
    lookAt(target, invert) {
        if (invert) {
            this.quaternion.setFromRotationMatrix(_aim.aim(target, this.position, this.up));
        } else {
            this.quaternion.setFromRotationMatrix(_aim.aim(this.position, target, this.up));
        }
    }

    // Decompose this node's local `matrix` back into position / quaternion /
    // scale (the quaternion's onChange keeps `rotation` in sync).
    decompose() {
        this.matrix.decompose(this.position, this.quaternion, this.scale);
        // decompose writes the quaternion buffer in place (no Quat method), so
        // fire the sync manually to refresh `rotation`.
        this.quaternion.onChange();
        return this;
    }

    setRotation(quaternion) {
        this.quaternion.copy(quaternion);
    }

    rotateX(angle) {
        this.quaternion.rotateX(angle);
    }

    rotateY(angle) {
        this.quaternion.rotateY(angle);
    }

    rotateZ(angle) {
        this.quaternion.rotateZ(angle);
    }

    getEuler(out = new Euler()) {
        return out.setFromQuaternion(this.quaternion, 'YXZ');
    }
}
