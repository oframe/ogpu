import { Vec2 } from '@math';

// Unified pointer state, fed by the InteractionManager's gsap Observer.
// Positions in canvas pixels; ndc is WebGPU/GL normalized device coords
// (x right, y up, [-1, 1]) — feed it straight to Raycast.castMouse.
export class Pointer {
    constructor() {
        this.position = new Vec2();
        this.ndc = new Vec2();
        this.delta = new Vec2();
        this.velocity = new Vec2(); // px/s, Observer-tracked
        this.downPosition = new Vec2();
        this.isDown = false;
        this.isDragging = false;
        this.inside = false;
    }

    _updateNdc(element) {
        const rect = element.getBoundingClientRect();
        const w = Math.max(rect.width, 1);
        const h = Math.max(rect.height, 1);
        this.ndc.set((this.position[0] / w) * 2 - 1, 1 - (this.position[1] / h) * 2);
    }

    // distance travelled since press, px
    get travel() {
        return this.position.distance(this.downPosition);
    }
}
