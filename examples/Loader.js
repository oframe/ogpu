// Default boot overlay for the examples. Subscribes to a Renderer's boot
// lifecycle and drives the #ogpu-loader markup (ring fill + fade-out) in
// index.html. All the DOM lives here, not in the engine — bring your own loader
// by registering the same two hooks (addBootProgressHandler /
// addBootCompleteHandler) against a different element.
export class Loader {
    constructor(renderer, { el = '#ogpu-loader' } = {}) {
        this.el = typeof el === 'string' ? document.querySelector(el) : el;
        if (!this.el) return;
        this.ring = this.el.querySelector('.ogpu-loader__ring');

        this._offProgress = renderer.addBootProgressHandler((pct) => {
            this.ring?.style.setProperty('--p', pct);
        });
        this._offComplete = renderer.addBootCompleteHandler(() => this._hide());
    }

    _hide() {
        if (this._hidden) return;
        this._hidden = true;
        this._offProgress?.();
        this._offComplete?.();

        const el = this.el;
        el.classList.add('is-hidden');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // Fallback removal if the transition never fires.
        setTimeout(() => el.remove(), 600);
    }
}
