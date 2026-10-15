#!/bin/sh
# Scaffold a new OGPU example: a renderer + camera + orbit + update loop and a
# single spinning cube (Box primitive -> Shader + UniformBuffer -> Mesh). Generates the
# example class and its shader under examples/<dir>/. It does NOT touch
# src/main.js — wiring the ?src= switch + landing entry is done by the caller
# (the skill's SKILL.md covers it), since that's structured editing.
#
# Usage: scaffold-app.sh <Name>
#   <Name> is used verbatim as the class name; the directory and ?src= value
#   are its lowercased form. e.g. `scaffold-app.sh Ripples` ->
#   examples/ripples/Ripples.js, class Ripples, ?src=ripples
set -e

if [ -n "$1" ]; then
    NAME=$1
else
    printf "Enter example name (PascalCase, e.g. Ripples): "
    read NAME
fi

if [ -z "$NAME" ]; then
    echo "Error: example name required"
    exit 1
fi

# Resolve repo root from this script's location (.claude/skills/scaffold-app/scripts).
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

CLASS=$NAME
DIR=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')
EX_DIR="$ROOT/examples/$DIR"

if [ -e "$EX_DIR" ]; then
    echo "Error: $EX_DIR already exists"
    exit 1
fi

mkdir -p "$EX_DIR"

cat > "$EX_DIR/cube.wgsl" <<'WGSL'
// validate-prepend: ../../src/core/engine.wgsl
// `camera` and `object` (group 1) come from the engine block Shader appends

struct Uniforms {
  uScale : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Vertex {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vNormal : vec3f,
}

@vertex
fn vs(in : Vertex) -> VertexOutput {
  var out : VertexOutput;
  let localPos = in.position * uniforms.uScale;
  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(localPos, 1.0)));
  out.vNormal = object.normalMatrix * in.normal;
  out.vUv = in.uv;
  return out;
}

@fragment
fn fs(in : VertexOutput) -> @location(0) vec4f {
  return vec4f(normalize(in.vNormal) * 0.5 + 0.5, 1.0);
}
WGSL

cat > "$EX_DIR/$CLASS.js" <<JS
import { Box, Mesh, Renderer, Shader, UniformBuffer, Transform, Camera, Orbit } from 'ogpu';

import cubeShader from './cube.wgsl?raw';

export class $CLASS {
    constructor({ el = null } = {}) {
        this.init(el);
    }

    async init(el) {
        const canvas = el || document.getElementById('web-gpu-canvas');
        this.renderer = new Renderer({ canvas, dpr: 2 });
        await this.renderer.ready;
        this.gpu = this.renderer.gpu;

        this.camera = new Camera({
            aspect: this.gpu.canvas.width / this.gpu.canvas.height,
            fov: 45,
            near: 0.1,
            far: 100,
        });
        this.camera.position.set(0, 0, 6);
        this.camera.lookAt([0, 0, 0]);
        this.orbit = new Orbit(this.camera, { element: this.gpu.canvas });

        this.scene = new Transform();

        // Box primitive -> Shader (+ UniformBuffer) -> Mesh. A Mesh takes no gpu and
        // no pipeline: the renderer derives one from shader + state + the pass.
        const geometry = new Box(this.gpu);
        const shader = new Shader(this.gpu, { label: '$DIR-cube-shader', code: cubeShader });
        this.uniforms = new UniformBuffer(this.gpu, shader.uniforms, { uScale: 1 }, { label: '$DIR-cube-uniforms' });

        this.cube = new Mesh({
            label: '$DIR-cube',
            geometry,
            shader,
            state: { cullMode: 'back' },
            // bind by WGSL name; group(1) is the engine's (camera + object)
            bindGroups: [shader.bindGroup(0, { uniforms: this.uniforms })],
        });
        this.cube.setParent(this.scene);

        addEventListener('resize', this.handleResize);
        setTimeout(() => this.handleResize(), 150);

        this.gpu.renderer.add(this.update);
    }

    update = ({ time, deltaTime }) => {
        this.cube.rotateX(deltaTime * 0.6);
        this.cube.rotateY(deltaTime * 0.9);

        this.orbit.update();
        this.renderer.render({ scene: this.scene, camera: this.camera });
    };

    handleResize = () => {
        this.camera.aspect = this.renderer.canvas.width / this.renderer.canvas.height;
        this.camera.updateProjectionMatrix();
    };
}
JS

echo "Created OGPU example '$CLASS':"
echo "  examples/$DIR/$CLASS.js"
echo "  examples/$DIR/cube.wgsl"
echo ""
echo "Next: wire src/main.js (import + ?src=$DIR views entry + landing entry)."
echo "Then visit ?src=$DIR in the dev server."
