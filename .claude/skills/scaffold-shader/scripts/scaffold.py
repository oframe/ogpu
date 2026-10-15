#!/usr/bin/env python3
"""Scaffold a minimal OGPU WGSL shader.

Writes a vs/fs shader following the engine's conventions (`vs`/`fs` entry
points, attribute order position/normal/uv). Camera/object matrices are NOT
declared: the engine block `Shader` appends supplies `camera.*` (group 1,
per pass) and `object.*` (group 1, per draw), so the file starts with a
`// validate-prepend:` line pointing at src/core/engine.wgsl for the validator.
The fragment stage outputs the normal mapped to 0..1. Custom uniforms are
opt-in (`--uniforms`). The output is a STARTING POINT -- the caller layers any
task-specific modifications (textures, shading) on top after generation.

Usage:
  python scaffold.py --out examples/foo/foo.wgsl
  python scaffold.py --out ./my.wgsl --uniforms uScale:f32,uTint:vec3f
"""
import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
ENGINE = os.path.join(ROOT, "src", "core", "engine.wgsl")


def parse_uniforms(arg):
    if not arg:
        return []
    fields = []
    for tok in (t.strip() for t in arg.split(",") if t.strip()):
        m = re.fullmatch(r"(\w+):(\w+)", tok)
        if not m:
            sys.exit(f"bad --uniforms entry '{tok}' (want name:type, e.g. uScale:f32)")
        fields.append(m.groups())
    return fields


def build(fields, engine_rel):
    lines = []
    a = lines.append

    a(f"// validate-prepend: {engine_rel}")
    a("// `camera` and `object` (group 1) come from the engine block Shader appends")
    a("")

    # Custom uniforms only; the engine fields live in camera/object.
    if fields:
        a("struct Uniforms {")
        for n, t in fields:
            a(f"  {n} : {t},")
        a("}")
        a("")
        a("@group(0) @binding(0) var<uniform> uniforms : Uniforms;")
        a("")

    # Vertex IO -- attribute order must match geometry data order.
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
    a("  out.position = camera.projectionMatrix * (camera.viewMatrix * (object.modelMatrix * vec4f(in.position, 1.0)));")
    a("  out.vNormal = object.normalMatrix * in.normal;")
    a("  out.vUv = in.uv;")
    a("  return out;")
    a("}")

    # Fragment stage -- normal mapped to 0..1.
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
    p.add_argument("--uniforms", help="custom uniform fields name:type, comma-separated (default: none)")
    p.add_argument("--force", action="store_true", help="overwrite if exists")
    args = p.parse_args()

    if os.path.exists(args.out) and not args.force:
        sys.exit(f"refusing to overwrite existing {args.out} (pass --force)")

    out_dir = os.path.dirname(os.path.abspath(args.out))
    engine_rel = os.path.relpath(ENGINE, out_dir)
    code = build(parse_uniforms(args.uniforms), engine_rel)

    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w") as f:
        f.write(code)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
