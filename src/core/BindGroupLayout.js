import { UniformBuffer } from './UniformBuffer.js';

// One GPUBindGroupLayout plus the WGSL names of its bindings. Shader,
// RenderPipeline and ComputeShader hand these out from bindGroupLayout(…);
// never construct one directly.
//
// Interned per device: the raw layout by shape (entries incl. visibility and
// the buffer/texture/sampler/storageTexture/externalTexture fields), the engine
// object by shape + group + names + declared. Equal explicit layouts are
// group-equivalent (WebGPU §8.1.2), so kernels reading the same bindings share
// one object and one set of bind groups, and a shape-preserving hot reload
// hands back the same objects. `label` comes from the first creator, so an
// error can name another shader built from the same code.
export class BindGroupLayout {
    constructor(device, { layout, entries, names, declared, label, group }) {
        this.device = device;
        this.layout = layout;
        this.entries = entries;
        this.names = names;
        this.declared = declared;
        this.label = label;
        this.group = group;
        this._declared = new Set(declared);
        this._bindGroupLabel = `${label}-group-${group}`;
    }

    // Resources by WGSL name. A UniformBuffer or GPUBuffer binds whole;
    // `{ buffer, offset, size }`, views, samplers and external textures pass
    // through. A name the module doesn't declare in this group throws; a
    // declared name outside this layout is dropped (one object can feed every
    // kernel's layout); a binding of this layout left out (or null) throws.
    // Allocates a new GPUBindGroup per call: build once, rebuild only when a
    // resource changes.
    createBindGroup(resources = {}, { label } = {}) {
        const names = this.names;
        const entries = [];
        for (const name in resources) {
            const binding = names[name];
            if (binding === undefined) {
                if (!this._declared.has(name)) {
                    throw new Error(`[${this.label}] no binding '${name}' in group(${this.group}) — declared: ${this.declared.join(', ') || 'none'}`);
                }
                continue;
            }
            const resource = resources[name];
            if (resource == null) continue;
            entries.push({ binding, resource: asResource(resource) });
        }
        if (entries.length !== this.entries.length) {
            const needs = Object.keys(names);
            const missing = needs.filter((n) => resources[n] == null);
            throw new Error(`[${this.label}] group(${this.group}) is missing ${missing.join(', ')} (needs ${needs.join(', ')})`);
        }
        return this.device.createBindGroup({ label: label ?? this._bindGroupLabel, layout: this.layout, entries });
    }
}

const caches = new WeakMap(); // GPUDevice -> { raw: Map<shape, GPUBindGroupLayout>, objects: Map<key, BindGroupLayout> }

// The interned BindGroupLayout for `entries` (one group of a
// bindGroupLayoutDescriptors result for `entryPoints`) of a module reflected as `defs`.
export function internBindGroupLayout(device, defs, group, entries, label, entryPoints) {
    let cache = caches.get(device);
    if (!cache) caches.set(device, (cache = { raw: new Map(), objects: new Map() }));

    const sorted = [...entries].sort((a, b) => a.binding - b.binding);
    const shape = canonical(sorted);
    const { names, declared } = bindingNames(defs, group, sorted, label, entryPoints);
    const key = `${shape}|${group}|${Object.entries(names).join(';')}|${declared.join(',')}`;

    let object = cache.objects.get(key);
    if (!object) {
        let layout = cache.raw.get(shape);
        if (!layout) {
            layout = device.createBindGroupLayout({ label: `${label}-group-${group}-layout`, entries: sorted });
            cache.raw.set(shape, layout);
        }
        object = new BindGroupLayout(device, { layout, entries: deepFreeze(structuredClone(sorted)), names, declared, label, group });
        cache.objects.set(key, object);
    }
    return object;
}

// Wraps a layout the engine didn't derive (a ComputeShader's explicit caller
// `layout`, a Shader group no entry point reads): names cover every binding the
// module declares in `group`, nothing is interned.
export function wrapBindGroupLayout(device, layout, defs, group, label, { empty = false } = {}) {
    const entries = empty ? [] : declaredBindings(defs, group).map(([, binding]) => ({ binding }));
    const { names, declared } = bindingNames(defs, group, entries, label);
    return new BindGroupLayout(device, { layout, entries: deepFreeze(entries), names, declared, label, group });
}

// [name, binding] for every resource the module declares in `group`
export function declaredBindings(defs, group) {
    const out = [];
    for (const kind of KINDS) {
        const vars = defs[kind];
        for (const name in vars) if (vars[name].group === group) out.push([name, vars[name].binding]);
    }
    return out.sort((a, b) => a[1] - b[1]);
}

const KINDS = ['uniforms', 'storages', 'textures', 'samplers', 'storageTextures', 'externalTextures'];

// names: WGSL name -> binding for this layout's entries (null-proto, frozen),
// from the resources of the entry points that built it when given (WGSL lets two
// vars share a binding if no one entry point uses both); declared: every name
// the module declares in `group`
function bindingNames(defs, group, entries, label, entryPoints) {
    const byBinding = new Map();
    const pairs = declaredBindings(defs, group);
    const declared = pairs.map(([name]) => name).sort();
    if (entryPoints) {
        for (const ep of entryPoints) {
            for (const r of defs.entryPoints[ep]?.resources ?? []) if (r.group === group) byBinding.set(r.entry.binding, r.name);
        }
    } else {
        for (const [name, binding] of pairs) byBinding.set(binding, name);
    }
    const names = Object.create(null);
    for (const { binding } of entries) {
        const name = byBinding.get(binding);
        if (name === undefined) throw new Error(`[${label}] group(${group}) binding ${binding} has no reflected name`);
        names[name] = binding;
    }
    return { names: Object.freeze(names), declared: Object.freeze(declared) };
}

// key-sorted serialisation, so equal entries give equal keys whatever their field order
function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v)
            .filter((k) => v[k] !== undefined)
            .sort()
            .map((k) => `${k}:${canonical(v[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v);
}

function deepFreeze(v) {
    if (v && typeof v === 'object') {
        for (const k in v) deepFreeze(v[k]);
        Object.freeze(v);
    }
    return v;
}

function asResource(r) {
    if (r instanceof GPUBuffer) return { buffer: r };
    if (r instanceof UniformBuffer) return { buffer: r.buffer };
    return r;
}
