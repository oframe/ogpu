import { makeBindGroupLayoutDescriptors } from '@utils/webgpu-utils.js';

const STAGE_KEY = { 1: 'vertex', 2: 'fragment', 4: 'compute' }; // GPUShaderStage bits

// Bind group layout descriptors for the named entry points (one per stage), via
// webgpu-utils. Only resources an entry point actually uses are included
// (callers build bind groups against exactly that set), following helper calls
// and switch-case bodies (not a switch selector: a binding read only there is
// dropped); visibility is the union of the stages that use a binding.
//
// Returns a (possibly sparse) array indexed by group, each `{ entries }` sorted
// by binding. `skip` drops whole groups (the engine's group).
export function bindGroupLayoutDescriptors(defs, entryPoints, { skip = [] } = {}) {
    const desc = {};
    for (const name of entryPoints) {
        const ep = defs.entryPoints[name];
        if (!ep) continue;
        const key = STAGE_KEY[ep.stage];
        if (desc[key]) throw new Error(`two ${key} entry points: '${desc[key].entryPoint}', '${name}'`);
        desc[key] = { entryPoint: name };
    }
    const groups = makeBindGroupLayoutDescriptors(defs, desc);
    for (const g of skip) delete groups[g];
    while (groups.length && !groups[groups.length - 1]) groups.length--;
    return groups;
}
