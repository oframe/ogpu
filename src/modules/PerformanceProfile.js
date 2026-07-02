import { getGPUTier } from 'detect-gpu';
import { NonNegativeRollingAverage } from '@utils/miscutils';

const TIERS = ['low', 'medium', 'high', 'ultra'];
const QUALITY_KEY = 'ogpu-quality';

const isValidQuality = (q) => TIERS.includes(q);
const nextLowerQuality = (q) => TIERS[Math.max(0, TIERS.indexOf(q) - 1)];

/**
 * Device performance profile: detect-gpu tier + platform/capability probe,
 * a recommended engine quality tier, and an opt-in frame-time watchdog that
 * *suggests* (never forces) a downgrade.
 */
export class PerformanceProfile {
    #callbacks = new Set();

    static async detect(gpu, { overrides = {} } = {}) {
        const p = new PerformanceProfile();

        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        const uaData = typeof navigator !== 'undefined' ? navigator.userAgentData : undefined;
        const maxTouch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;

        // platform detection — prefer userAgentData, fall back to UA sniffing.
        const uaPlatform = (uaData?.platform || '').toLowerCase();
        const brands = (uaData?.brands || []).map((b) => (b.brand || '').toLowerCase()).join(' ');
        const looksMac = uaPlatform.includes('mac') || /mac/i.test(ua);
        // iPadOS 13+ masquerades as desktop Mac — betrayed by a touch screen.
        const isIPadOSMac = looksMac && maxTouch > 1;
        p.isIOS = uaPlatform.includes('ios') || /iphone|ipad|ipod/i.test(ua) || isIPadOSMac;
        p.isAndroid = uaPlatform.includes('android') || brands.includes('android') || /android/i.test(ua);

        let tierResult;
        try {
            tierResult = await getGPUTier();
        } catch {
            tierResult = null;
        }

        const uaMobile = /mobi|android|iphone|ipad|ipod/i.test(ua) || p.isIOS || p.isAndroid;
        if (tierResult) {
            p.tier = tierResult.tier ?? (uaMobile ? 1 : 2);
            p.gpuName = tierResult.gpu ?? 'unknown';
            p.fps = tierResult.fps;
            p.isMobile = Boolean(tierResult.isMobile) || uaMobile;
        } else {
            // detect-gpu threw or timed out — conservative fallback.
            p.tier = uaMobile ? 1 : 2;
            p.gpuName = 'unknown';
            p.fps = undefined;
            p.isMobile = uaMobile;
        }

        p.dpr = Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 3);
        p.deviceMemory = typeof navigator !== 'undefined' && navigator.deviceMemory != null ? navigator.deviceMemory : null;
        p.hardwareConcurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency != null ? navigator.hardwareConcurrency : null;

        const feats = gpu?.device?.features ?? [];
        p.features = Array.from(feats).sort();

        const limits = gpu?.device?.limits ?? {};
        p.limits = {
            maxTextureDimension2D: limits.maxTextureDimension2D,
            maxBufferSize: limits.maxBufferSize,
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
            maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
            maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
        };

        const has = (f) => p.features.includes(f);
        p.compressedTextures = has('texture-compression-bc') ? 'bc' : has('texture-compression-astc') ? 'astc' : has('texture-compression-etc2') ? 'etc2' : 'none';

        p.quality = resolveQuality(p, overrides);
        p.recommendedDpr = recommendDpr(p.quality, p.dpr);

        return p;
    }

    setQuality(tier) {
        if (!isValidQuality(tier)) throw new Error(`invalid quality tier: ${tier}`);
        this.quality = tier;
        persistQuality(tier);
        for (const cb of this.#callbacks) cb(tier);
    }

    onQualityChange(cb) {
        this.#callbacks.add(cb);
        return () => this.#callbacks.delete(cb);
    }

    addGUI(gui) {
        const folder = gui.folder('performance-profile');

        const proxy = { quality: this.quality };
        const dropdown = folder.add(proxy, 'quality', { options: { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' } });
        dropdown.on('change', (ev) => this.setQuality(ev.value));

        const platform = this.isIOS ? 'ios' : this.isAndroid ? 'android' : 'desktop';
        const info = {
            'gpu-name': String(this.gpuName),
            tier: String(this.tier),
            platform,
            mobile: String(this.isMobile),
            dpr: `${this.dpr} (rec ${this.recommendedDpr})`,
            'device-memory': this.deviceMemory == null ? 'n/a' : String(this.deviceMemory),
            'hardware-concurrency': this.hardwareConcurrency == null ? 'n/a' : String(this.hardwareConcurrency),
            'compressed-textures': this.compressedTextures,
        };
        for (const key of Object.keys(info)) folder.monitor(info, key);

        // Keep the dropdown in sync if quality changes elsewhere.
        this.onQualityChange((q) => {
            proxy.quality = q;
            dropdown.refresh?.();
        });

        return folder;
    }

    startWatchdog(renderer, { windowSize = 90, thresholdMs = 22, cooldownMs = 4000, onSuggestDowngrade } = {}) {
        const avg = new NonNegativeRollingAverage(windowSize);
        let frames = 0;
        let lastSuggest = -Infinity;

        const tick = ({ deltaTime }) => {
            avg.addSample(deltaTime * 1000); // seconds → ms
            if (++frames < windowSize) return;

            const avgMs = avg.get();
            if (avgMs <= thresholdMs || this.quality === 'low') return;

            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (now - lastSuggest < cooldownMs) return;
            lastSuggest = now;
            onSuggestDowngrade?.(nextLowerQuality(this.quality), avgMs);
        };

        renderer.add(tick);
        return () => renderer.remove(tick);
    }
}

function resolveQuality(p, overrides) {
    // 1. query-string param (persisted).
    let params;
    try {
        params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    } catch {
        params = null;
    }
    const qParam = params?.get('quality');
    if (qParam && isValidQuality(qParam)) {
        persistQuality(qParam);
        return qParam;
    }

    // 2. persisted localStorage value.
    const stored = readStoredQuality();
    if (stored) return stored;

    // 3. explicit override.
    if (overrides.quality && isValidQuality(overrides.quality)) return overrides.quality;

    // 4. tier → quality mapping.
    return mapTierToQuality(p.tier, p.isMobile);
}

function mapTierToQuality(tier, isMobile) {
    switch (tier) {
        case 0:
            return 'low';
        case 1:
            return isMobile ? 'low' : 'medium';
        case 2:
            return isMobile ? 'medium' : 'high';
        case 3:
            return isMobile ? 'high' : 'ultra';
        default:
            return isMobile ? 'low' : 'medium';
    }
}

function recommendDpr(quality, dpr) {
    switch (quality) {
        case 'low':
            return Math.min(dpr, 1);
        case 'medium':
            return Math.min(dpr, 1.5);
        case 'high':
            return Math.min(dpr, 2);
        default:
            return dpr;
    }
}

function persistQuality(tier) {
    try {
        localStorage.setItem(QUALITY_KEY, tier);
    } catch {
        // storage unavailable (private mode / no DOM) — non-fatal.
    }
}

function readStoredQuality() {
    try {
        const v = localStorage.getItem(QUALITY_KEY);
        return isValidQuality(v) ? v : null;
    } catch {
        return null;
    }
}
