// Bind group layout descriptors from reflected entry points. Only resources an
// entry point actually uses are included (callers build bind groups against
// exactly that set — e.g. noisevolume's `bake` omits tSmooth); visibility is the
// union of the stages that use a binding. wgsl_reflect ≥1.6 follows calls and
// switch-case bodies, so bindings read only inside a case are no longer dropped.
//
// entryPoints: names to include. Returns a (possibly sparse) array indexed by group,
// each `{ entries }` sorted by binding. `skip` drops whole groups (the engine's group).
export function bindGroupLayoutDescriptors(defs, entryPoints, { skip = [] } = {}) {
    const groups = [];
    for (const name of entryPoints) {
        const ep = defs.entryPoints[name];
        if (!ep) continue;
        for (const { group, entry } of ep.resources) {
            if (skip.includes(group)) continue;
            const byBinding = (groups[group] ??= new Map());
            const prev = byBinding.get(entry.binding);
            byBinding.set(entry.binding, {
                ...entry,
                visibility: entry.visibility | (prev?.visibility ?? 0),
            });
        }
    }
    return groups.map((m) => ({ entries: [...m.values()].sort((a, b) => a.binding - b.binding) }));
}
