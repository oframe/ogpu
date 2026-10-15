// SplitText-style reveal presets for MSDFText.animate(name, overrides). Every preset is a
// "from" state the units tween out of; `split` staggers, `mask` clips (overflow-hidden).
// Units: x/y/z in em, x/yPercent in % of the unit's own box, rotations in degrees.
export const TEXT_PRESETS = {
    // gsap's canonical SplitText line reveal: each line slides up out of its own mask
    'lines-slide': {
        split: 'lines',
        mask: 'lines',
        from: { yPercent: -100 },
        duration: 1.1,
        stagger: 0.12,
        ease: 'expo.out',
    },
    // chars rise inside line masks — mask unit and stagger unit differ on purpose
    'chars-slide': {
        split: 'chars',
        mask: 'lines',
        from: { yPercent: -100 },
        duration: 0.9,
        stagger: 0.02,
        ease: 'power4.out',
    },
    'words-slide': {
        split: 'words',
        mask: 'words',
        from: { yPercent: -100, rotation: 6 },
        origin: [0, 0],
        duration: 1,
        stagger: 0.06,
        ease: 'power3.out',
    },
    // clip-path inset reveal, left to right per line
    'lines-wipe': {
        split: 'lines',
        wipe: 'left-to-right',
        wipeSoftness: 0.15,
        from: { x: -0.2, opacity: 0.4 },
        duration: 1.2,
        stagger: 0.1,
        ease: 'power3.inOut',
    },
    'chars-wipe': {
        split: 'chars',
        wipe: 'bottom-to-top',
        wipeSoftness: 0.3,
        duration: 0.6,
        stagger: 0.025,
        ease: 'power2.out',
    },
    'chars-fade-up': {
        split: 'chars',
        from: { y: -0.4, opacity: 0 },
        duration: 0.8,
        stagger: 0.025,
        ease: 'power3.out',
    },
    // sdf blur: the edge ramp widens instead of sampling a blur — free per glyph
    'chars-blur': {
        split: 'chars',
        from: { opacity: 0, blur: 0.12, scale: 1.25 },
        duration: 1,
        stagger: 0.03,
        order: 'random',
        ease: 'power2.out',
    },
    'words-flip': {
        split: 'words',
        from: { rotationX: -90, opacity: 0, z: -0.3 },
        origin: [0.5, 0],
        duration: 1.1,
        stagger: 0.08,
        ease: 'back.out',
    },
    'chars-pop': {
        split: 'chars',
        from: { scale: 0, rotation: -25, opacity: 0 },
        duration: 0.7,
        stagger: 0.03,
        order: 'center',
        ease: 'back.out',
    },
};
