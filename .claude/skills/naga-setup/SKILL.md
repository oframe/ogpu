---
name: naga-setup
description: One-time installation of naga WGSL validation into a repo that doesn't have it yet — writes a PostToolUse hook, a batch validate-shaders script, and an npm entry, so shader checking then happens automatically forever after with no skill involved. Use ONLY for the setup act itself: "set up naga here", "add the shader validation hook to this project", "wire up WGSL checking in my new repo", "port my naga setup over", or scaffolding a fresh WebGPU project that will need it. Do NOT use this to validate a shader — validating is the installed hook's job, and if the repo is already set up there is nothing here to do.
---

# naga-setup

Wire a repo so every WGSL edit is compiled by `naga` immediately, and the whole
shader tree can be checked in one command. WGSL errors otherwise only surface in
the browser console after a reload — the hook collapses that loop to zero.

This is a one-shot installer, not a validator. Once it runs, the hook does the
checking on its own for every future session — nobody invokes this skill again.
So the first move is to check whether the repo is already set up: if
`.claude/settings.json` already has a naga `PostToolUse` hook, say so and stop.
Re-running would duplicate the hook, and a shader that needs checking just needs
`naga <file>`, not this.

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

### 1. Check naga is installed

```bash
naga --version
```

If missing, tell the user to install it and stop — the hook is inert without it:

```
brew install naga-cli    # macOS / Linux — NOT `brew install naga`, that formula
                         # is a Snake game and collides on the same binary name
cargo install naga-cli   # any platform with Rust
```

That `naga` vs `naga-cli` collision is a real trap worth naming out loud; people
install the wrong one and get a game.

Also check `jq --version` — the hook uses it to read the tool payload. On macOS
it usually ships already; if absent, `brew install jq`.

### 2. Install the hook

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

Copy `assets/validate-shaders.mjs` from this skill into the repo's `scripts/`
directory (create it if needed). The script walks `src/` when that exists,
otherwise the repo root, skipping `node_modules`/`.git`/build output. It also
accepts explicit paths: `node scripts/validate-shaders.mjs path/to/one.wgsl`.

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
