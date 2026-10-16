import { Camera, Renderer, Orbit, GUI, Transform, MSDFFont, MSDFText, TEXT_PRESETS } from 'ogpu';

const FONT = './assets/fonts/instrument-serif/instrumentserif-regular';

const HEADLINE = 'Signed distance\nfields, revealed.';
const BODY =
    'Every glyph is one instanced quad sampling a multi-channel distance atlas baked by ' +
    'msdfgen. The split into chars, words and lines happens once on the CPU; the stagger, ' +
    'the masks and the clip wipes are evaluated per glyph in the vertex shader, so a reveal ' +
    'costs one uniform write a frame.';

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
        this.renderer.setClearColor({ r: 0.055, g: 0.05, b: 0.045 });

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 35,
        });
        this.camera.position.set(0, 0, 6);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        const font = await MSDFFont.load(this.gpu, {
            json: `${FONT}.json`,
            image: `${FONT}.png`,
            label: 'instrument-serif',
        });

        this.headline = new MSDFText(this.gpu, {
            label: 'headline',
            font,
            text: HEADLINE,
            size: 0.62,
            lineHeight: 1.05,
            letterSpacing: -0.01,
            anchorY: 'bottom',
            color: [0.96, 0.93, 0.86, 1],
            outlineColor: [0.9, 0.42, 0.22, 1],
        });
        this.headline.position.y = 0.05;

        this.body = new MSDFText(this.gpu, {
            label: 'body',
            font,
            text: BODY,
            size: 0.13,
            width: 3.6,
            lineHeight: 1.35,
            anchorY: 'top',
            color: [0.78, 0.74, 0.66, 1],
        });
        this.body.position.y = -0.2;

        this.scene.addChild(this.headline);
        this.scene.addChild(this.body);

        this.initGUI();
        this.intro();

        this.renderer.addResizeHandler(this.handleResize);
        this.renderer.add(this.update);
    }

    async intro() {
        this.headline.animate('lines-slide');
        this.body.animate('chars-fade-up', { stagger: 0.006, delay: 0.5 });
        this.body.play();
        await this.headline.play();
    }

    initGUI() {
        const gui = new GUI({ title: 'msdf-text' });
        const params = (this.params = {
            target: 'headline',
            preset: 'lines-slide',
            ...this.presetParams('lines-slide'),
            scrub: 0,
            outline: 0,
            text: HEADLINE,
        });
        const targets = () => (params.target === 'both' ? [this.headline, this.body] : [this[params.target]]);

        gui.add(params, 'target', { options: option(['headline', 'body', 'both']) });
        gui.add(params, 'preset', { options: option(Object.keys(TEXT_PRESETS)) }).on('change', () => {
            Object.assign(params, this.presetParams(params.preset));
            gui.pane.refresh();
            this.replay(targets());
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
        tune.pane.on('change', () => this.replay(targets()));

        const play = gui.folder('playback');
        play.button('play', () => targets().forEach((t) => t.play()));
        play.button('reverse', () => targets().forEach((t) => t.reverse()));
        play.button('replay', () => this.replay(targets()));
        play.add(params, 'scrub', { min: 0, max: 1, step: 0.001 }).on('change', ({ value }) => {
            targets().forEach((t) => (t.progress = value));
        });
        play.monitor(this.headline, 'progress', { label: 'headline' });
        play.monitor(this.body, 'progress', { label: 'body' });

        const look = gui.folder('look', { expanded: false });
        // outline reads the true-sdf alpha channel, so it reaches up to pxRange/2 atlas px
        look.add(params, 'outline', { min: 0, max: 0.12, step: 0.002 }).on('change', ({ value }) => {
            for (const t of [this.headline, this.body]) t.uniforms.set({ uOutline: value });
        });
        look.add(params, 'text').on('change', ({ value }) => {
            this.headline.setText(value.replace(/\\n/g, '\n'));
            this.replay([this.headline]);
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

    replay(texts) {
        const { preset, split, mask, order, ease, duration } = this.params;
        for (const t of texts) {
            // body has ~10x the chars of the headline — same total spread, finer stagger
            const stagger = this.params.stagger * (t === this.body && split === 'chars' ? 0.2 : 1);
            t.animate(preset, { split, mask, order, ease, duration, stagger }).play();
        }
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
