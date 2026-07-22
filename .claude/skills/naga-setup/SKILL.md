---
name: naga-setup
description: Get naga WGSL validation working in a repo — installs the `naga`/`jq` toolchain, a PostToolUse hook that compiles every .wgsl on write, and a batch validate-shaders script, so shader checking then happens automatically with no skill involved. Use for the setup act: "set up naga here", "add the shader validation hook", "wire up WGSL checking in my new repo", "port my naga setup over", scaffolding a fresh WebGPU project — and also on a fresh clone of a repo that already ships the hook, since the config arrives with the clone but the naga binary does not, leaving a hook that silently does nothing. Do NOT use this to validate a shader; validating is the installed hook's job or a plain `naga <file>`.
---

# naga-setup

Wire a repo so every WGSL edit is compiled by `naga` immediately, and the whole
shader tree can be checked in one command. WGSL errors otherwise only surface in
the browser console after a reload — this collapses that loop to zero.

## The thing to keep straight

A working setup is four artifacts, and they arrive by different routes:

| | Artifact | Travels with a `git clone`? |
|---|---|---|
| **Repo config** | `.claude/settings.json` hook — runs `naga` after each `Edit`/`Write` of a `.wgsl`, exits 2 on failure so the compiler error blocks and gets fixed in the same turn | yes |
| | `scripts/validate-shaders.mjs` + npm entry — batch check for CI or a refactor that touched many shaders; the hook only sees files an agent writes, the script sees all of them | yes |
| **Local toolchain** | `naga` binary | **no** |
| | `jq` binary | **no** |

So a fresh clone of an already-wired repo still has half a setup: a hook that
fires and does nothing, because `naga` isn't on the machine. That's why step 1 is
the toolchain and not the config. Check each artifact, install whichever are
missing, and when all four are present say so and stop — re-adding the hook just
duplicates it.

## Steps

### 1. Check the local toolchain

```bash
naga --version
jq --version
```

Missing `naga` makes everything else inert, so fix it first — and offer to run the
install rather than just quoting it, since on a fresh clone this is usually the
only gap:

```
brew install naga-cli    # macOS / Linux — NOT `brew install naga`, that formula
                         # is a Snake game and collides on the same binary name
cargo install naga-cli   # any platform with Rust
```

If `naga --version` succeeds but prints something that isn't a wgpu version
string, that's the Snake game — people hit this often enough to be worth checking
rather than assuming a zero exit means the compiler.

`jq` reads the tool payload for the hook. Usually present on macOS; `brew install jq`
otherwise.

### 2. Install the hook

Already a naga entry under `hooks.PostToolUse` in the repo's `.claude/settings.json`?
Leave it and move on.

Otherwise add it there — the repo's file, not the user's global one, so it travels
with the repo and doesn't fire in unrelated projects:

```json
{
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "Edit|Write|MultiEdit",
                "hooks": [
                    {
                        "type": "command",
                        "command": "f=$(jq -r '.tool_input.file_path // empty'); case \"$f\" in *.wgsl) out=$(naga \"$f\" 2>&1) || { echo \"WGSL validation failed: $f\" >&2; echo \"$out\" >&2; exit 2; };; esac",
                        "statusMessage": "Validating WGSL with naga"
                    }
                ]
            }
        ]
    }
}
```

**Merge, don't clobber.** If `.claude/settings.json` exists, read it and append to
the existing `hooks.PostToolUse` array — overwriting someone's settings to add a
shader check is a bad trade.

Notes in case the command needs adapting:

- The payload arrives as JSON on stdin; `jq -r '.tool_input.file_path'` pulls the path out. It's absolute, so the hook works regardless of cwd.
- The `case` guard means non-WGSL edits cost one shell spawn and exit silently — cheap enough to leave unconditional.
- Exit code 2 is what makes it *blocking*: stderr goes back to the agent. Any other non-zero code just warns.

### 3. Install the batch script

Already a `scripts/validate-shaders.mjs`? Leave it — a repo's copy may have been
adapted, and overwriting it with a near-identical file is a bad trade.

Otherwise copy `assets/validate-shaders.mjs` into the repo's `scripts/` (create it
if needed). It walks the whole tree from the root, skipping generated and vendored
directories — deliberately not just `src/`, since shaders also live in `examples/`,
`demos/`, `sandbox/`, and a batch check that quietly misses most of them is worse
than no batch check. Widen its `SKIP` set if the repo has a big generated directory
the default misses. It also takes explicit paths:
`node scripts/validate-shaders.mjs path/to/one.wgsl`.

Exit codes: 0 all valid, 1 a shader failed, 2 naga not installed.

If the repo has a `package.json`, add:

```json
"scripts": { "validate:shaders": "node scripts/validate-shaders.mjs" }
```

Not a node project? Leave the script without the npm entry — it only needs a `node`
binary. No node at all? Install the hook alone and say the batch command isn't
available.

**In a monorepo**, the script's scope is the parent of wherever it sits:
`packages/renderer/scripts/` validates that package, the repo root validates all of
them. Ask which the user wants — per-package when one package has shaders, root
when several do — and put the npm entry in whichever `package.json` sits beside it.
The hook needs no such choice; one at the repo root covers every package.

### 4. Verify it actually fires

Don't declare victory on a config write. Prove both halves:

```bash
node scripts/validate-shaders.mjs   # expect ok/FAIL lines for the repo's real shaders
```

Then test the hook by writing a deliberately broken shader — `let x: f32 = ;` —
with the Write tool. Use a temp path outside the repo (`/tmp/naga-hook-check.wgsl`);
the hook matches on the tool, not the location, so it fires just the same and
nothing lands in the user's tree. Expect it to block with naga's parse error.
Delete the file after.

Hook silent? Usual causes, in order: settings not loaded yet (hooks load at session
start — restart the session or run `/hooks` to reload), `jq` missing, or `naga` not
on the PATH the hook's shell sees.

### 5. Mention it in the repo's agent docs

If there's an `AGENTS.md` / `CLAUDE.md` with a commands section, add a line so
future agents know the check exists and can use it instead of a browser round-trip:

```
- `npm run validate:shaders` — validate every `**/*.wgsl` with `naga`. Install via
  `brew install naga-cli` (not `brew install naga`). Single file:
  `node scripts/validate-shaders.mjs <file>`.
```

## What this does and doesn't catch

`naga` compiles one WGSL file standalone. That covers syntax, types, and bad
builtins — the bulk of shader mistakes — but it knows nothing about the host side:
bind group layouts, vertex buffer formats, uniform struct field names the JS
expects. A shader can validate clean and still render nothing. Say so plainly if
the user seems to expect a correctness guarantee.

The standalone part also cuts the other way: a `.wgsl` file that's a *fragment*
meant to be concatenated into a larger shader will fail validation on its own,
which is a false alarm rather than a bug. Repos with a shader-chunk system either
want those paths in the script's `SKIP` set or want the hook narrowed — worth
raising before the user concludes the setup is broken.
