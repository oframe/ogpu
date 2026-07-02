// Easing helpers on top of gsap: named-ease lookup, CSS-style cubic-bezier,
// and a curated list for GUI dropdowns. All return plain (t: 0..1) => number
// functions usable inside and outside gsap tweens.

import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

/** Resolve any gsap ease name ('power2.out', 'elastic.inOut(1, 0.4)') to a function. */
export function ease(name) {
    return gsap.parseEase(name);
}

const bezierCache = new Map();

/** CSS-style cubic-bezier(x1, y1, x2, y2) via CustomEase, memoized. */
export function cubicBezier(x1, y1, x2, y2) {
    const key = `${x1},${y1},${x2},${y2}`;
    let fn = bezierCache.get(key);
    if (!fn) {
        fn = CustomEase.create(`cubic-bezier-${bezierCache.size}`, `M0,0 C${x1},${y1} ${x2},${y2} 1,1`);
        bezierCache.set(key, fn);
    }
    return fn;
}

// GUI-dropdown-friendly set — every gsap family, out flavor first.
export const EASE_NAMES = [
    'none',
    'power1.out',
    'power2.out',
    'power3.out',
    'power4.out',
    'power2.in',
    'power2.inOut',
    'sine.out',
    'sine.inOut',
    'expo.out',
    'expo.inOut',
    'circ.out',
    'back.out(1.7)',
    'back.inOut(1.7)',
    'elastic.out(1, 0.3)',
    'bounce.out',
];
