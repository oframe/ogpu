import { Renderer, Camera, Transform, Orbit, GUI, MSDFFont, Text } from 'ogpu';

const PARAGRAPH =
    'MSDF text renders from a single small atlas: median-of-three decode keeps corners sharp where plain SDF rounds them off, ' +
    'and the fwidth-scaled distance range gives crisp antialiasing at any scale or perspective. ' +
    'Layout supports kerning pairs, letter and line spacing, word wrap and per-line alignment.';

export class TextExample {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.scene = new Transform();
        this.camera = new Camera({ aspect: this.gpu.canvas.width / this.gpu.canvas.height, fov: 45, near: 0.1, far: 100 });
        this.camera.position.set(0, 0.5, 14);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.font = await MSDFFont.load(this.gpu, { json: './assets/fonts/roboto.json' });

        this.headline = new Text(this.gpu, {
            font: this.font,
            text: 'OGPU MSDF TEXT',
            fontSize: 1.6,
            letterSpacing: 0.02,
            align: 'center',
            anchorX: 'center',
            anchorY: 'baseline',
            color: [1, 0.85, 0.3],
            outlineColor: [0.9, 0.2, 0.4],
            label: 'headline',
        });
        this.headline.position.set(0, 3.2, 0);
        this.headline.setParent(this.scene);

        this.paragraph = new Text(this.gpu, {
            font: this.font,
            text: PARAGRAPH,
            fontSize: 0.42,
            maxWidth: 11,
            lineHeight: 1.25,
            anchorX: 'center',
            anchorY: 'top',
            color: [0.92, 0.92, 0.95],
            label: 'paragraph',
        });
        this.paragraph.position.set(0, 2.1, 0);
        this.paragraph.setParent(this.scene);

        this.counter = new Text(this.gpu, {
            font: this.font,
            text: '0.00s',
            fontSize: 0.8,
            align: 'center',
            anchorX: 'center',
            color: [0.4, 0.9, 1.0],
            billboard: true,
            label: 'counter',
        });
        this.counter.position.set(0, -4.4, 0);
        this.counter.setParent(this.scene);

        this.initPane();

        this.renderer.addResizeHandler((width, height) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        });

        this.renderer.add(this.update);
    }

    initPane() {
        this.gui = new GUI({ title: 'msdf-text', expanded: true });

        this.stats = { fps: 0 };
        this.gui.monitor(this.stats, 'fps', { view: 'graph', min: 0, max: 130 });

        const layoutSettings = { fontSize: 0.42, letterSpacing: 0, lineHeight: 1.25, maxWidth: 11, align: 'left' };
        const relayout = () => this.paragraph.set(layoutSettings);

        const para = this.gui.folder('paragraph-layout', { expanded: true });
        para.add(layoutSettings, 'fontSize', { min: 0.1, max: 1.2, step: 0.01, label: 'font-size' }).on('change', relayout);
        para.add(layoutSettings, 'letterSpacing', { min: -0.05, max: 0.3, step: 0.005, label: 'letter-spacing' }).on('change', relayout);
        para.add(layoutSettings, 'lineHeight', { min: 0.8, max: 2, step: 0.05, label: 'line-height' }).on('change', relayout);
        para.add(layoutSettings, 'maxWidth', { min: 4, max: 20, step: 0.5, label: 'max-width' }).on('change', relayout);
        para.add(layoutSettings, 'align', { options: { left: 'left', center: 'center', right: 'right' } }).on('change', relayout);

        const style = this.gui.folder('headline-style', { expanded: true });
        const colorView = this.headline.uniforms.views.uColor;
        const colorProxy = { color: { r: colorView[0], g: colorView[1], b: colorView[2] } };
        style.add(colorProxy, 'color', { color: { type: 'float' } }).on('change', (ev) => {
            this.headline.uniforms.set({ uColor: [ev.value.r, ev.value.g, ev.value.b] });
        });
        style.uniform(this.headline, 'uOutlineWidth', { min: 0, max: 0.4, step: 0.005, label: 'outline-width' });
        style.uniform(this.headline, 'uSoftness', { min: 0, max: 1, step: 0.01, label: 'softness' });
        style.uniform(this.headline, 'uOpacity', { min: 0, max: 1, step: 0.01, label: 'opacity' });

        const counter = this.gui.folder('counter', { expanded: false });
        const counterProxy = { billboard: true };
        counter.add(counterProxy, 'billboard').on('change', (ev) => {
            this.counter.uniforms.set({ uBillboard: ev.value ? 1 : 0 });
        });
    }

    update = ({ time = 0, deltaTime = 0 } = {}) => {
        if (deltaTime > 0) this.stats.fps += (1 / deltaTime - this.stats.fps) * 0.05;
        this.orbit.update();

        // live relayout every frame — the geometry-recreation cost demo
        this.counter.set({ text: `${time.toFixed(2)}s` });

        this.renderer.render({ scene: this.scene, camera: this.camera });
    };
}
