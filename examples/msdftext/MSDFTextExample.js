import { Camera, Renderer, Orbit, GUI, Transform, MSDFFont, MSDFText, TEXT_PRESETS } from 'ogpu';

// same font, copy and layout as OGL's msdf-text example
const FONT = './assets/fonts/fira-sans/firasans-bold';
const TEXT = "don't panic";

const option = (keys) => Object.fromEntries(keys.map((k) => [k, k]));

export class MSDFTextExample {
    constructor() {
        // built here, not in init(): main.js wires the boot loader to app.renderer synchronously
        const canvas = document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        this.init().catch((e) => console.error('[msdftext] init failed', e));
    }

    async init() {
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;
        this.renderer.setClearColor({ r: 1, g: 1, b: 1 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
        });
        this.camera.position.set(0, 0, 7);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const font = await MSDFFont.load(this.gpu, {
            json: `${FONT}.json`,
            image: `${FONT}.png`,
            label: 'fira-sans-bold',
        });

        this.text = new MSDFText(this.gpu, {
            label: 'text',
            font,
            text: TEXT,
            size: 1,
            width: 4,
            align: 'center',
            letterSpacing: -0.05,
            lineHeight: 1.1,
            color: [0, 0, 0, 1],
            outlineColor: [0.9, 0.42, 0.22, 1],
        });
        this.scene.addChild(this.text);

        this.initGUI();
        this.text.animate('lines-slide').play();

        this.renderer.addResizeHandler(this.handleResize);
        this.renderer.add(this.update);
    }

    initGUI() {
        const gui = new GUI({ title: 'msdf-text' });
        const params = (this.params = {
            wireframe: false,
            preset: 'lines-slide',
            ...this.presetParams('lines-slide'),
            scrub: 0,
            outline: 0,
            text: TEXT,
        });

        gui.add(params, 'wireframe').on('change', ({ value }) => {
            this.text.wireframe = value;
        });
        gui.add(params, 'preset', { options: option(Object.keys(TEXT_PRESETS)) }).on('change', () => {
            Object.assign(params, this.presetParams(params.preset));
            gui.pane.refresh();
            this.replay();
        });

        const tune = gui.folder('split');
        tune.add(params, 'split', { options: option(['chars', 'words', 'lines']) });
        tune.add(params, 'mask', { options: option(['none', 'chars', 'words', 'lines']) });
        tune.add(params, 'order', {
            options: option(['start', 'end', 'center', 'edges', 'random']),
        });
        tune.add(params, 'ease', {
            options: option(['expo.out', 'power2.out', 'power3.out', 'power4.out', 'power3.inOut', 'expo.inOut', 'back.out', 'elastic.out', 'sine.out', 'circ.out', 'linear']),
        });
        tune.add(params, 'duration', { min: 0.1, max: 3, step: 0.05 });
        tune.add(params, 'stagger', { min: 0, max: 0.3, step: 0.002 });
        tune.pane.on('change', () => this.replay());

        const play = gui.folder('playback');
        play.button('play', () => this.text.play());
        play.button('reverse', () => this.text.reverse());
        play.button('replay', () => this.replay());
        play.add(params, 'scrub', { min: 0, max: 1, step: 0.001 }).on('change', ({ value }) => {
            this.text.progress = value;
        });
        play.monitor(this.text, 'progress');

        const look = gui.folder('look', { expanded: false });
        // outline reads the true-sdf alpha channel, so it reaches up to pxRange/2 atlas px
        look.add(params, 'outline', { min: 0, max: 0.12, step: 0.002 }).on('change', ({ value }) => {
            this.text.uniforms.set({ uOutline: value });
        });
        look.add(params, 'text').on('change', ({ value }) => {
            this.text.setText(value.replace(/\\n/g, '\n'));
            this.replay();
        });

        this.gui = gui;
    }

    presetParams(name) {
        const p = TEXT_PRESETS[name];
        return {
            split: p.split ?? 'chars',
            mask: p.mask ?? 'none',
            order: p.order ?? 'start',
            ease: p.ease ?? 'power3.out',
            duration: p.duration ?? 1,
            stagger: p.stagger ?? 0.03,
        };
    }

    replay() {
        const { preset, split, mask, order, ease, duration, stagger } = this.params;
        this.text.animate(preset, { split, mask, order, ease, duration, stagger }).play();
    }

    update = () => {
        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.gpu.canvas.width / this.gpu.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
