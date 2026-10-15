import { makeShaderDataDefinitions } from 'webgpu-utils';

// WGSL → data definitions: webgpu-utils' `makeShaderDataDefinitions` (its
// bundled wgsl_reflect), plus `inputs` on each entry point:
//   { structs, uniforms, storages, storageTextures, textures, externalTextures,
//     samplers, immediates,
//     entryPoints: { name: { stage, resources: [{ name, group, entry }], inputs } } }
// inputs = the @location parameters ([{ name, location }]; vertex attributes for
// a vertex entry point), scanned on first read: only the pipeline cache reads
// them, once per pipeline.
//
// The parser gets a copy without comments (line breaks kept, so error line
// numbers hold), with two gaps in the bundled parser bridged (naga and Tint
// accept both forms):
// - `block` is rejected as an identifier ("Expected ';' after statement");
//   renamed, then restored in every reflected name.
// - a typed integer const with an expression initialiser, `const M: u32 =
//   (1u << 19u) - 1u;`, throws "Invalid cast from f32 to u32"; the type is
//   dropped (the value still folds, and reflection only needs it as a count).
const RESERVED = /\bblock\b/g;
const RENAMED = 'block__ogpu';
const TYPED_INT_CONST = /\b(const\s+\w+)\s*:\s*[iu]32\s*=/g;

export function reflect(code) {
    const source = stripComments(code);
    const renamed = RESERVED.test(source);
    RESERVED.lastIndex = 0;
    let parsed = source.replace(TYPED_INT_CONST, '$1 =');
    if (renamed) parsed = parsed.replace(RESERVED, RENAMED);

    const defs = renamed ? restoreNames(makeShaderDataDefinitions(parsed)) : makeShaderDataDefinitions(parsed);

    for (const [name, ep] of Object.entries(defs.entryPoints)) {
        let inputs;
        Object.defineProperty(ep, 'inputs', {
            enumerable: true,
            configurable: true,
            get: () => (inputs ??= locationInputs(source, name)),
        });
    }
    return defs;
}

const unrename = (n) => (n === RENAMED ? 'block' : n);

// copy with every key and every `name` value restored, key order kept (the
// library reads a struct's last field as its runtime-sized array)
function restoreNames(node) {
    if (Array.isArray(node)) return node.map(restoreNames);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [unrename(k), k === 'name' && typeof v === 'string' ? unrename(v) : restoreNames(v)]));
}

// WGSL block comments nest; a block comment becomes a space plus its line breaks
function stripComments(code) {
    const parts = [];
    let i = 0;
    while (i < code.length) {
        const line = code.indexOf('//', i);
        const block = code.indexOf('/*', i);
        if (line < 0 && block < 0) break;
        if (block < 0 || (line >= 0 && line < block)) {
            parts.push(code.slice(i, line));
            const nl = code.indexOf('\n', line);
            i = nl < 0 ? code.length : nl;
        } else {
            parts.push(code.slice(i, block), ' ');
            let depth = 1;
            let j = block + 2;
            while (depth > 0 && j < code.length) {
                const open = code.indexOf('/*', j);
                const close = code.indexOf('*/', j);
                if (close < 0) j = code.length;
                else if (open >= 0 && open < close) {
                    depth++;
                    j = open + 2;
                } else {
                    depth--;
                    j = close + 2;
                }
            }
            parts.push(code.slice(block, j).replace(/[^\n]/g, ''));
            i = j;
        }
    }
    parts.push(code.slice(i));
    return parts.join('');
}

// text between the bracket at `open` and its match
function balanced(src, open, l, r) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === l) depth++;
        else if (src[i] === r && --depth === 0) return src.slice(open + 1, i);
    }
    return '';
}

// split on commas outside (), <> and []
function topLevelList(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '<' || c === '[') depth++;
        else if (c === ')' || c === '>' || c === ']') depth--;
        else if (c === ',' && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

const LOCATION = /@location\s*\(\s*(\w+)\s*\)/;
// trailing `name : type` of a parameter or member, after its attributes
const DECL = /(\w+)\s*:\s*([\w<>, ]+?)\s*$/;

// a literal or a const with a literal value; anything else is left out of
// `inputs` (the check misses it, the pipeline still validates)
function locationOf(attr, src) {
    if (/^\d+[iu]?$/.test(attr)) return parseInt(attr);
    const m = new RegExp(`\\bconst\\s+${attr}\\s*(?::\\s*\\w+\\s*)?=\\s*(\\d+)[iu]?\\s*;`).exec(src);
    return m ? parseInt(m[1]) : null;
}

const push = (inputs, name, location) => {
    if (location !== null) inputs.push({ name, location });
};

// --- @location inputs (webgpu-utils doesn't expose them) ---
// The entry point's parameters, and the members of a struct-typed parameter.

function locationInputs(src, entryPoint) {
    const fn = new RegExp(`\\bfn\\s+${entryPoint}\\s*\\(`).exec(src);
    if (!fn) return [];
    const inputs = [];
    for (const param of topLevelList(balanced(src, fn.index + fn[0].length - 1, '(', ')'))) {
        const decl = DECL.exec(param);
        if (!decl) continue;
        const loc = LOCATION.exec(param);
        if (loc) {
            push(inputs, decl[1], locationOf(loc[1], src));
            continue;
        }
        const alias = new RegExp(`\\balias\\s+${decl[2]}\\s*=\\s*(\\w+)\\s*;`).exec(src);
        const type = alias ? alias[1] : decl[2];
        const struct = new RegExp(`\\bstruct\\s+${type}\\s*\\{`).exec(src);
        if (!struct) continue;
        const body = balanced(src, struct.index + struct[0].length - 1, '{', '}');
        for (const member of topLevelList(body)) {
            const m = LOCATION.exec(member);
            const d = DECL.exec(member);
            if (m && d) push(inputs, d[1], locationOf(m[1], src));
        }
    }
    return inputs;
}
