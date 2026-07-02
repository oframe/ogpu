import { Renderer, Transform, GUI, PerformanceProfile } from 'ogpu';

// Minimal profile viewer: detects the device profile, dumps it to the pane
// and the console, and runs the frame-time watchdog against an empty scene.
export class Performance {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.profile = await PerformanceProfile.detect(this.gpu);
        console.table({
            tier: this.profile.tier,
            gpu: this.profile.gpuName,
            quality: this.profile.quality,
            mobile: this.profile.isMobile,
            ios: this.profile.isIOS,
            android: this.profile.isAndroid,
            dpr: this.profile.dpr,
            'recommended-dpr': this.profile.recommendedDpr,
            'compressed-textures': this.profile.compressedTextures,
        });

        this.gui = new GUI({ title: 'performance', expanded: true });
        this.profile.addGUI(this.gui);

        this.stats = { fps: 0, suggestion: 'none' };
        const perf = this.gui.folder('runtime', { expanded: true });
        perf.monitor(this.stats, 'fps', { view: 'graph', min: 0, max: 130 });
        perf.monitor(this.stats, 'suggestion');

        this.stopWatchdog = this.profile.startWatchdog(this.renderer, {
            onSuggestDowngrade: (tier, avgMs) => {
                this.stats.suggestion = `${tier} (${avgMs.toFixed(1)}ms avg)`;
            },
        });

        this.scene = new Transform();
        this.renderer.add(this.update);
    }

    update = ({ deltaTime = 0 } = {}) => {
        if (deltaTime > 0) this.stats.fps += (1 / deltaTime - this.stats.fps) * 0.05;
        this.renderer.render({ scene: this.scene });
    };
}
