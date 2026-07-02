import { Renderer, Camera, Transform, Orbit, Mesh, RenderPipeline, Plane, Box, Sphere, GUI, InteractionManager, Spring, SPRING_PRESETS, ease, EASE_NAMES } from 'ogpu';
import { gsap } from 'gsap';

import shader from './interaction.wgsl?raw';

const COLORS = [
    [0.85, 0.3, 0.2],
    [0.25, 0.55, 0.85],
    [0.3, 0.75, 0.4],
    [0.9, 0.7, 0.2],
    [0.7, 0.3, 0.8],
    [0.2, 0.7, 0.7],
];

export class Interaction {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.scene = new Transform();
        this.camera = new Camera({ aspect: this.gpu.canvas.width / this.gpu.canvas.height, fov: 45, near: 0.1, far: 80 });
        this.camera.position.set(6, 6, 9);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.settings = {
            preset: 'wobbly',
            stiffness: SPRING_PRESETS.wobbly.stiffness,
            damping: SPRING_PRESETS.wobbly.damping,
            ease: 'back.out(1.7)',
            duration: 0.6,
            flingStrength: 0.35,
        };

        this.initScene();
        this.initInteraction();
        this.initPane();

        this.renderer.addResizeHandler((width, height) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        });

        this.renderer.add(this.update);
    }

    addMesh(geometry, { label, color, position }) {
        const mesh = new Mesh(this.gpu, {
            label,
            pipeline: this.pipeline,
            geometry,
            bindGroups: (uniformBuffer) => [
                this.gpu.device.createBindGroup({
                    label: `${label}-bind-group`,
                    layout: this.pipeline.bindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                }),
            ],
        });
        mesh.uniforms.set({ uColor: color });
        mesh.position.set(...position);
        mesh.setParent(this.scene);
        return mesh;
    }

    initScene() {
        const box = new Box(this.gpu);
        const sphere = new Sphere(this.gpu, { radius: 0.55 });
        const floor = new Plane(this.gpu, { width: 40, depth: 40 });

        this.pipeline = new RenderPipeline(this.gpu, {
            label: 'interaction-pipeline',
            code: shader,
            vertexBuffers: box.bufferLayouts,
        });

        const floorMesh = this.addMesh(floor, { label: 'floor', color: [0.32, 0.32, 0.35], position: [0, -0.5, 0] });
        floorMesh.frustumCulled = false;

        this.items = [];
        for (let i = 0; i < 6; i++) {
            const geometry = i % 2 ? sphere : box;
            const x = (i % 3) * 2.4 - 2.4;
            const z = Math.floor(i / 3) * 2.4 - 1.2;
            const mesh = this.addMesh(geometry, { label: `item-${i}`, color: COLORS[i], position: [x, 0.05, z] });
            mesh._baseColor = COLORS[i];
            this.items.push(mesh);
        }
    }

    initInteraction() {
        this.im = new InteractionManager({ renderer: this.renderer, camera: this.camera, dragPlaneNormal: 'up' });

        this.items.forEach((mesh) => {
            const spring = new Spring({ value: 1, preset: this.settings.preset });
            mesh._scaleSpring = spring;

            this.im.on(mesh, 'enter', () => spring.setTarget(1.3));
            this.im.on(mesh, 'leave', () => spring.setTarget(1));

            this.im.on(mesh, 'click', () => {
                const to = COLORS[Math.floor(Math.random() * COLORS.length)];
                const proxy = { r: mesh.uniforms.views.uColor[0], g: mesh.uniforms.views.uColor[1], b: mesh.uniforms.views.uColor[2] };
                gsap.to(proxy, {
                    r: to[0],
                    g: to[1],
                    b: to[2],
                    duration: this.settings.duration,
                    ease: ease(this.settings.ease),
                    onUpdate: () => mesh.uniforms.set({ uColor: [proxy.r, proxy.g, proxy.b] }),
                });
            });

            this.im.on(mesh, 'dragstart', () => {
                this.orbit.enabled = false;
                gsap.killTweensOf(mesh.position);
                spring.setTarget(1.15);
            });
            this.im.on(mesh, 'drag', ({ point, worldDelta }) => {
                mesh.position.x += worldDelta[0];
                mesh.position.z += worldDelta[2];
                mesh._flingVel = [worldDelta[0], worldDelta[2]];
                void point;
            });
            this.im.on(mesh, 'dragend', () => {
                this.orbit.enabled = true;
                spring.setTarget(1);
                const [vx, vz] = mesh._flingVel ?? [0, 0];
                // fling: glide along the last drag direction and settle
                gsap.to(mesh.position, {
                    x: mesh.position.x + vx * this.settings.flingStrength * 60,
                    z: mesh.position.z + vz * this.settings.flingStrength * 60,
                    duration: 0.9,
                    ease: 'power2.out',
                });
                mesh._flingVel = null;
            });
        });
    }

    initPane() {
        this.gui = new GUI({ title: 'interaction', expanded: true });

        const springs = this.gui.folder('hover-spring', { expanded: true });
        springs.add(this.settings, 'preset', { options: Object.fromEntries(Object.keys(SPRING_PRESETS).map((k) => [k, k])) }).on('change', (ev) => {
            const p = SPRING_PRESETS[ev.value];
            this.settings.stiffness = p.stiffness;
            this.settings.damping = p.damping;
            this._applySpringParams();
            this.gui.pane.refresh();
        });
        springs.add(this.settings, 'stiffness', { min: 20, max: 400, step: 1 }).on('change', () => this._applySpringParams());
        springs.add(this.settings, 'damping', { min: 2, max: 120, step: 1 }).on('change', () => this._applySpringParams());

        const click = this.gui.folder('click-tween', { expanded: true });
        click.add(this.settings, 'ease', { options: Object.fromEntries(EASE_NAMES.map((n) => [n, n])) });
        click.add(this.settings, 'duration', { min: 0.1, max: 2, step: 0.05 });

        const drag = this.gui.folder('drag', { expanded: true });
        drag.add(this.settings, 'flingStrength', { min: 0, max: 1, step: 0.01, label: 'fling-strength' });

        const pointer = this.gui.folder('pointer', { expanded: false });
        this.pointerInfo = { x: 0, y: 0, vx: 0, vy: 0 };
        pointer.monitor(this.pointerInfo, 'x');
        pointer.monitor(this.pointerInfo, 'y');
        pointer.monitor(this.pointerInfo, 'vx', { view: 'graph', min: -3000, max: 3000 });
        pointer.monitor(this.pointerInfo, 'vy', { view: 'graph', min: -3000, max: 3000 });
    }

    _applySpringParams() {
        this.items.forEach((mesh) => {
            mesh._scaleSpring.stiffness = this.settings.stiffness;
            mesh._scaleSpring.damping = this.settings.damping;
        });
    }

    update = ({ deltaTime = 0 } = {}) => {
        this.orbit.update();

        this.items.forEach((mesh) => {
            const s = mesh._scaleSpring.update(deltaTime);
            mesh.scale.set(s, s, s);
        });

        const p = this.im.pointer;
        this.pointerInfo.x = Math.round(p.position[0]);
        this.pointerInfo.y = Math.round(p.position[1]);
        this.pointerInfo.vx = p.velocity[0];
        this.pointerInfo.vy = p.velocity[1];

        this.renderer.render({ scene: this.scene, camera: this.camera });
    };
}
