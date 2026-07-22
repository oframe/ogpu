---
name: naga-setup
description: Get naga WGSL validation working in a repo — installs the `naga`/`jq` toolchain, a PostToolUse hook that compiles every .wgsl on write, and a batch validate-shaders script, so shader checking then happens automatically with no skill involved. Use for the setup act: "set up naga here", "add the shader validation hook", "wire up WGSL checking in my new repo", "port my naga setup over", scaffolding a fresh WebGPU project — and also on a fresh clone of a repo that already ships the hook, since the config arrives with the clone but the naga binary does not, leaving a hook that silently does nothing. Do NOT use this to validate a shader; validating is the installed hook's job or a plain `naga <file>`.
---

# naga-setup

Wire a repo so every WGSL edit is compiled by `naga` immediately, and the whole
shader tree can be checked in one command. WGSL errors otherwise only surface in
the browser console after a reload — the hook collapses that loop to zero.

This is a one-shot installer, not a validator. Once it's in place, the hook does
the checking on its own for every future session — nobody invokes this skill to
validate a shader.

Setup has two halves that travel differently, which is the thing to keep straight:

- **Repo config** — the hook and the script are files, so they arrive with a
  `git clone`.
- **Local toolchain** — `naga` and `jq` are binaries on the machine, and they do
  not.

So someone cloning a repo that's already wired still has half a setup: a hook
that fires and silently does nothing, or errors, because `naga` isn't installed.
Check the toolchain first (step 1) and the config second (step 2), and act on
whichever half is missing. Only when *both* halves are present is there nothing
to do — say so and stop rather than duplicating the hook.

Two pieces get installed:

1. **A `PostToolUse` hook** in the repo's `.claude/settings.json`. It fires after
   `Edit`/`Write`/`MultiEdit`, checks whether the touched file ends in `.wgsl`,
   and runs `naga` on it. On failure it exits 2, which feeds the compiler error
   back to the agent as a blocking error — so a broken shader is caught and fixed
   in the same turn instead of at runtime.
2. **`scripts/validate-shaders.mjs`** + an npm script, for batch checks (CI, or
   after a refactor that touched many shaders). The hook only sees files the
   agent writes; the script sees everything.

## Steps

### 1. Check the local toolchain

```bash
naga --version
jq --version
```

If `naga` is missing the hook is inert, so this is the half worth fixing first.
Offer to run the install rather than just quoting it — on a fresh clone this is
usually the *only* thing missing:

```
brew install naga-cli    # macOS / Linux — NOT `brew install naga`, that formula
                         # is a Snake game and collides on the same binary name
cargo install naga-cli   # any platform with Rust
```

That `naga` vs `naga-cli` collision is a real trap worth naming out loud; people
install the wrong one and get a game.

`jq` is what the hook uses to read the tool payload. On macOS it usually ships
already; if absent, `brew install jq`.

### 2. Install the hook

First look at whether it's already there — `.claude/settings.json` with a naga
entry under `hooks.PostToolUse` means this half came with the clone. In that case
skip to step 4 and verify it fires; adding it again would just duplicate it.

The hook goes in the **repo's** `.claude/settings.json` (project-scoped, so it
travels with the repo and doesn't fire in unrelated projects).

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

**Merge, don't clobber.** If `.claude/settings.json` already exists, read it and
add this entry to the existing `hooks.PostToolUse` array — overwriting someone's
settings to add a shader check is a bad trade. If a naga hook is already there,
say so and stop rather than adding a duplicate.

Notes on the command, in case it needs adapting:

- The hook receives the tool payload as JSON on stdin; `jq -r '.tool_input.file_path'` pulls the path out.
- The `case` guard means non-WGSL edits cost one shell spawn and exit silently — cheap enough to leave unconditional.
- Exit code 2 is what makes it *blocking*: stderr goes back to the agent. Any other non-zero code just warns.

### 3. Install the batch script

Already a `scripts/validate-shaders.mjs`? Leave it — a repo's own copy may have
been adapted, and overwriting it to install a near-identical file is a bad trade.

Otherwise copy `assets/validate-shaders.mjs` from this skill into the repo's
`scripts/` directory (create it if needed). It walks the whole repo from the root,
skipping `node_modules`/`.git`/build output — deliberately not just `src/`, since
shaders tend to also live in `examples/`, `demos/`, `sandbox/`, and a batch check
that quietly misses most of them is worse than no batch check. It also accepts
explicit paths: `node scripts/validate-shaders.mjs path/to/one.wgsl`.

Worth widening `SKIP` if the repo has a big generated or vendored directory the
default set misses.

**In a monorepo**, the script's scope is the parent of wherever you put it —
`packages/renderer/scripts/` validates just that package, the repo root validates
every package. Ask which the user wants rather than defaulting; per-package is
usually right when only one package has shaders, root when several do. The npm
entry then goes in whichever `package.json` sits beside it. The hook is unaffected
either way: it gets an absolute path from the tool payload, so it validates the
edited file no matter which package it lives in or what the cwd is.

Exit codes: 0 all valid, 1 a shader failed, 2 naga not installed.

If the repo has a `package.json`, add:

```json
"scripts": { "validate:shaders": "node scripts/validate-shaders.mjs" }
```

Repo isn't a node project? Skip the npm entry and just leave the script — it only
needs a `node` binary. If node isn't available at all, install the hook alone and
tell the user the batch command is unavailable.

### 4. Verify it actually fires

Don't declare victory on a config write. Prove it:

```bash
node scripts/validate-shaders.mjs   # should print ok/FAIL lines for real shaders
```

Then confirm the hook itself works by writing a deliberately broken shader with
the Write tool (e.g. `let x: f32 = ;`) — the hook should block with naga's error.
Delete the file after. If the hook is silent, the usual causes are: settings not
picked up yet (hooks load at session start — the user may need to restart the
session or run `/hooks` to reload), `jq` missing, or `naga` not on the PATH the
hook shell sees.

### 5. Mention it in the repo's agent docs

If the repo has an `AGENTS.md` / `CLAUDE.md` with a commands section, add a line
so future agents know the check exists and can run it without a browser:

```
- `npm run validate:shaders` — validate every `**/*.wgsl` with `naga`. Install via
  `brew install naga-cli` (not `brew install naga`). Single file:
  `node scripts/validate-shaders.mjs <file>`.
```

## Scope

`naga` validates a single WGSL file in isolation. It catches syntax errors, type
errors, and bad builtins — the bulk of shader mistakes. It does **not** know
about the host side: bind group layouts, vertex buffer formats, or uniform struct
field names that the JS expects. A shader can compile clean and still render
nothing. Say this plainly if the user seems to expect a full correctness check.
