// Damped harmonic spring, framerate-independent via fixed substeps.
// Works on scalars or any Float32Array-like (Vec2/Vec3/Vec4) — value and
// target keep whatever shape you construct with.

export const SPRING_PRESETS = {
    gentle: { stiffness: 120, damping: 14 },
    wobbly: { stiffness: 180, damping: 12 },
    stiff: { stiffness: 210, damping: 20 },
    slow: { stiffness: 280, damping: 60 },
    molasses: { stiffness: 280, damping: 120 },
};

const SUBSTEP = 1 / 120;
const MAX_DT = 1 / 30;

export class Spring {
    /**
     * @param {object} opts
     * @param {number} [opts.stiffness=170] spring constant k
     * @param {number} [opts.damping=26] damping coefficient c
     * @param {number} [opts.mass=1]
     * @param {number|ArrayLike} [opts.value=0] initial value — scalar or vector
     * @param {number|ArrayLike} [opts.target] defaults to value
     * @param {number} [opts.precision=1e-3] rest threshold on value+velocity
     * @param {string} [opts.preset] SPRING_PRESETS key, overrides stiffness/damping
     */
    constructor({ stiffness = 170, damping = 26, mass = 1, value = 0, target, precision = 1e-3, preset } = {}) {
        if (preset && SPRING_PRESETS[preset]) {
            stiffness = SPRING_PRESETS[preset].stiffness;
            damping = SPRING_PRESETS[preset].damping;
        }
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
        this.precision = precision;

        this._scalar = typeof value === 'number';
        const size = this._scalar ? 1 : value.length;
        this._value = new Float32Array(size);
        this._target = new Float32Array(size);
        this._velocity = new Float32Array(size);

        this._write(this._value, value);
        this._write(this._target, target ?? value);

        this.resting = true;
        this._restCallbacks = new Set();
    }

    _write(arr, v) {
        if (typeof v === 'number') {
            arr.fill(v);
        } else {
            arr.set(v);
        }
    }

    get value() {
        return this._scalar ? this._value[0] : this._value;
    }

    get velocity() {
        return this._scalar ? this._velocity[0] : this._velocity;
    }

    get target() {
        return this._scalar ? this._target[0] : this._target;
    }

    set target(v) {
        this.setTarget(v);
    }

    setTarget(v) {
        this._write(this._target, v);
        this.resting = false;
        return this;
    }

    // hard-set value (and target) without animating
    jump(v) {
        this._write(this._value, v);
        this._write(this._target, v);
        this._velocity.fill(0);
        this.resting = true;
        return this;
    }

    // add an impulse (e.g. pointer fling velocity, units/s)
    kick(v) {
        if (typeof v === 'number') {
            for (let i = 0; i < this._velocity.length; i++) this._velocity[i] += v;
        } else {
            for (let i = 0; i < v.length; i++) this._velocity[i] += v[i];
        }
        this.resting = false;
        return this;
    }

    onRest(cb) {
        this._restCallbacks.add(cb);
        return () => this._restCallbacks.delete(cb);
    }

    /** Advance by dt seconds. Returns the current value. */
    update(dt) {
        if (this.resting) return this.value;

        let remaining = Math.min(dt, MAX_DT);
        const { stiffness, damping, mass } = this;

        while (remaining > 0) {
            const h = Math.min(SUBSTEP, remaining);
            for (let i = 0; i < this._value.length; i++) {
                const displacement = this._value[i] - this._target[i];
                const accel = (-stiffness * displacement - damping * this._velocity[i]) / mass;
                this._velocity[i] += accel * h;
                this._value[i] += this._velocity[i] * h;
            }
            remaining -= h;
        }

        let done = true;
        for (let i = 0; i < this._value.length; i++) {
            if (Math.abs(this._velocity[i]) > this.precision || Math.abs(this._value[i] - this._target[i]) > this.precision) {
                done = false;
                break;
            }
        }
        if (done) {
            this._value.set(this._target);
            this._velocity.fill(0);
            this.resting = true;
            this._restCallbacks.forEach((cb) => cb?.(this.value));
        }

        return this.value;
    }
}
