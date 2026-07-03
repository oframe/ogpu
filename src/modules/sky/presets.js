// Sky presets: mode + atmosphere + grading + artistic palette keyframes.
//
// Palette stop colors are linear rgb in [0,1]; `intensity` lifts the stops to
// HDR radiance, `sunDiskIntensity` scales the disk (drives IBL speculars).
// The day / sunset / night keyframes are blended by sun elevation in
// Sky._blendPalette — GUI edits target one keyframe at a time.
//
// Grading tints are ~1-neutral multipliers; `amount` fades the whole grade,
// `shadowAmount` gates the low-luminance shadow tint.

const NEUTRAL_GRADE = {
    tintZenith: [1, 1, 1],
    tintHorizon: [1, 1, 1],
    tintSunHalo: [1, 1, 1],
    tintShadow: [1, 1, 1],
    shadowAmount: 0,
    saturation: 1,
    contrast: 1,
    amount: 0,
};

const DEFAULT_PALETTE = {
    day: {
        zenith: [0.2, 0.45, 0.95],
        horizon: [0.65, 0.8, 0.98],
        ground: [0.35, 0.36, 0.38],
        halo: [1.0, 0.95, 0.85],
        haloExponent: 12,
        sunDisk: [1.0, 0.98, 0.92],
        intensity: 2.5,
        sunDiskIntensity: 120,
    },
    sunset: {
        zenith: [0.12, 0.18, 0.45],
        horizon: [1.0, 0.45, 0.2],
        ground: [0.16, 0.12, 0.12],
        halo: [1.0, 0.55, 0.25],
        haloExponent: 5,
        sunDisk: [1.0, 0.55, 0.25],
        intensity: 1.6,
        sunDiskIntensity: 60,
    },
    night: {
        zenith: [0.01, 0.015, 0.045],
        horizon: [0.03, 0.045, 0.09],
        ground: [0.008, 0.008, 0.012],
        halo: [0.1, 0.12, 0.2],
        haloExponent: 4,
        sunDisk: [0.9, 0.9, 1.0],
        intensity: 0.35,
        sunDiskIntensity: 2,
    },
};

export const SKY_PRESETS = {
    physical: {
        mode: 'physical',
        turbidity: 2.5,
        sunIntensity: 20,
        multiScatter: 1,
        grade: { ...NEUTRAL_GRADE },
        palette: DEFAULT_PALETTE,
    },

    'ghibli-pastel': {
        mode: 'artistic',
        turbidity: 2,
        sunIntensity: 20,
        multiScatter: 1,
        grade: {
            tintZenith: [0.88, 0.97, 1.1],
            tintHorizon: [1.1, 1.03, 0.96],
            tintSunHalo: [1.12, 1.04, 0.9],
            tintShadow: [0.92, 0.96, 1.12],
            shadowAmount: 0.4,
            saturation: 0.85,
            contrast: 0.9,
            amount: 1,
        },
        palette: {
            day: {
                zenith: [0.36, 0.6, 0.95],
                horizon: [0.82, 0.9, 0.97],
                ground: [0.5, 0.56, 0.55],
                halo: [1.0, 0.97, 0.85],
                haloExponent: 10,
                sunDisk: [1.0, 0.98, 0.9],
                intensity: 3,
                sunDiskIntensity: 80,
            },
            sunset: {
                zenith: [0.3, 0.32, 0.62],
                horizon: [0.98, 0.62, 0.45],
                ground: [0.24, 0.2, 0.22],
                halo: [1.0, 0.7, 0.45],
                haloExponent: 4,
                sunDisk: [1.0, 0.62, 0.35],
                intensity: 2,
                sunDiskIntensity: 40,
            },
            night: {
                zenith: [0.04, 0.06, 0.14],
                horizon: [0.09, 0.11, 0.2],
                ground: [0.03, 0.035, 0.05],
                halo: [0.15, 0.17, 0.28],
                haloExponent: 4,
                sunDisk: [0.9, 0.9, 1.0],
                intensity: 0.6,
                sunDiskIntensity: 3,
            },
        },
    },

    'golden-hour': {
        mode: 'physical',
        turbidity: 4.5,
        sunIntensity: 24,
        multiScatter: 0.8,
        grade: {
            tintZenith: [0.95, 0.92, 1.02],
            tintHorizon: [1.15, 1.0, 0.82],
            tintSunHalo: [1.25, 1.02, 0.7],
            tintShadow: [0.85, 0.82, 1.0],
            shadowAmount: 0.3,
            saturation: 1.15,
            contrast: 1.05,
            amount: 1,
        },
        palette: DEFAULT_PALETTE,
    },

    moody: {
        mode: 'physical',
        turbidity: 7,
        sunIntensity: 16,
        multiScatter: 1.4,
        grade: {
            tintZenith: [0.85, 0.9, 1.0],
            tintHorizon: [0.95, 0.95, 1.0],
            tintSunHalo: [1.05, 0.98, 0.9],
            tintShadow: [0.8, 0.85, 1.05],
            shadowAmount: 0.6,
            saturation: 0.6,
            contrast: 1.15,
            amount: 1,
        },
        palette: DEFAULT_PALETTE,
    },
};
