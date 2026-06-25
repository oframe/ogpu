#!/usr/bin/env python3
"""Scaffold a minimal OGPU WGSL shader.

Writes a vs/fs shader following the engine's reflection conventions (uniform
block `uniforms : Uniforms`, `vs`/`fs` entry points, attribute order
position/normal/uv). The fragment stage outputs the normal mapped to 0..1.
The output is a STARTING POINT — the caller layers any task-specific
modifications (custom uniforms, textures, shading) on top after generation.

Usage:
  python scaffold.py --out examples/foo/foo.wgsl
  python scaffold.py --out ./my.wgsl --std projectionMatrix,modelViewMatrix,normalMatrix,time
"""
import argparse
import os
import sys

STD_FIELDS = {
    "projectionMatrix": "mat4x4f",
    "viewMatrix": "mat4x4f",
    "modelViewMatrix": "mat4x4f",
    "modelMatrix": "mat4x4f",
    "objectMatrix": "mat4x4f",
    "normalMatrix": "mat3x3f",
    "cameraPosition": "vec3f",
    "cameraQuaternion": "vec4f",
    "resolution": "vec2f",
    "time": "f32",
}

# vs/fs in the template use these — kept by default so the base compiles.
DEFAULT_STD = ["projectionMatrix", "modelViewMatrix", "normalMatrix"]


def parse_std(arg):
    if arg is None:
        return DEFAULT_STD
    names = [t.strip() for t in arg.split(",") if t.strip()]
    bad = [n for n in names if n not in STD_FIELDS]
    if bad:
        sys.exit(f"unknown standard uniform(s): {', '.join(bad)}\n"
                 f"valid: {', '.join(STD_FIELDS)}")
    return names


def build(std_names):
    lines = []
    a = lines.append

    # Uniforms struct
    a("struct Uniforms {")
    for n in std_names:
        a(f"  {n} : {STD_FIELDS[n]},")
    a("}")
    a("")
    a("@group(0) @binding(0) var<uniform> uniforms : Uniforms;")

    # Vertex IO — attribute order must match geometry data order.
    a("")
    a("struct Vertex {")
    a("  @location(0) position : vec3f,")
    a("  @location(1) normal : vec3f,")
    a("  @location(2) uv : vec2f,")
    a("}")
    a("")
    a("struct VertexOutput {")
    a("  @builtin(position) position : vec4f,")
    a("  @location(0) vUv : vec2f,")
    a("  @location(1) vNormal : vec3f,")
    a("}")

    # Vertex stage
    a("")
    a("@vertex")
    a("fn vs(in : Vertex) -> VertexOutput {")
    a("  var out : VertexOutput;")
    a("  out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4f(in.position, 1.0);")
    a("  out.vNormal = uniforms.normalMatrix * in.normal;")
    a("  out.vUv = in.uv;")
    a("  return out;")
    a("}")

    # Fragment stage — normal mapped to 0..1.
    a("")
    a("@fragment")
    a("fn fs(in : VertexOutput) -> @location(0) vec4f {")
    a("  return vec4f(normalize(in.vNormal) * 0.5 + 0.5, 1.0);")
    a("}")
    a("")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description="Scaffold a OGPU WGSL shader.")
    p.add_argument("--out", required=True, help="output .wgsl path")
    p.add_argument("--std", help=f"comma std uniforms (default: {','.join(DEFAULT_STD)})")
    p.add_argument("--force", action="store_true", help="overwrite if exists")
    args = p.parse_args()

    if os.path.exists(args.out) and not args.force:
        sys.exit(f"refusing to overwrite existing {args.out} (pass --force)")

    code = build(parse_std(args.std))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        f.write(code)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
