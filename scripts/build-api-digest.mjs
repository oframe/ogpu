#!/usr/bin/env node
// Emits api-digest.md: per-file public-surface index of src/ (exported classes
// + public method signatures, functions/consts, re-exports). Read a file's API
// without opening it. Dep-free regex heuristic, relies on 4-space indent.
// Run: node scripts/build-api-digest.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const EXAMPLES = join(ROOT, 'examples');
const MAX_PARAMS = 90; // truncate long destructured signatures

// JS keywords sharing the `name(` shape — never methods.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'super', 'else', 'do', 'with', 'throw', 'function', 'await', 'typeof', 'delete', 'void', 'yield']);

function walk(dir, out = []) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|mjs)$/.test(name)) out.push(full);
    }
    return out;
}

// From an opening "(" at code[start], return the balanced param string.
function balancedParams(code, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < code.length; i++) {
        const c = code[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) {
                let s = code
                    .slice(openIdx + 1, i)
                    .replace(/\s+/g, ' ')
                    .trim();
                if (s.length > MAX_PARAMS) s = s.slice(0, MAX_PARAMS - 1) + '…';
                return s;
            }
        }
    }
    return '';
}

function parseFile(file) {
    const code = readFileSync(file, 'utf8');
    const lines = code.split('\n');
    const result = { classes: [], functions: [], consts: [], reexports: [] };

    let current = null; // active exported class

    // Offset of each line start in `code`, for balancedParams.
    const lineOffsets = [];
    let acc = 0;
    for (const l of lines) {
        lineOffsets.push(acc);
        acc += l.length + 1;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // exported class
        let m = line.match(/^export class (\w+)(?:\s+extends\s+([\w.]+))?/);
        if (m) {
            current = { name: m[1], extends: m[2] || null, methods: [] };
            result.classes.push(current);
            continue;
        }

        // class body ends at a column-0 brace
        if (current && /^\}/.test(line)) {
            current = null;
            continue;
        }

        // method: exactly 4-space indent (no more, else body lines match) + name(.
        // Skip _private, accessors, control-flow keywords.
        if (current) {
            const mm = line.match(/^ {4}(?:async\s+)?(?:\*\s*)?(\w+)\s*\(/);
            if (mm) {
                const name = mm[1];
                if (name === 'get' || name === 'set') continue;
                if (name.startsWith('_')) continue;
                if (KEYWORDS.has(name)) continue;
                const open = lineOffsets[i] + line.indexOf('(');
                const params = balancedParams(code, open);
                current.methods.push(`${name}(${params})`);
            }
            continue;
        }

        // top-level exported function
        m = line.match(/^export (?:async\s+)?function (\w+)\s*\(/);
        if (m) {
            const open = lineOffsets[i] + line.indexOf('(');
            result.functions.push(`${m[1]}(${balancedParams(code, open)})`);
            continue;
        }

        // exported const: arrow/function value -> capture as function, else const.
        m = line.match(/^export const (\w+)\s*=/);
        if (m) {
            // = (params) => / = async (params) => / = function(params)
            const after = code.slice(lineOffsets[i] + m[0].length);
            const fnHead = after.match(/^\s*(?:async\s+)?(?:function\s*)?\(/);
            if (fnHead) {
                const open = lineOffsets[i] + m[0].length + after.indexOf('(');
                result.functions.push(`${m[1]}(${balancedParams(code, open)})`);
            } else {
                result.consts.push(m[1]);
            }
            continue;
        }

        // barrel re-export: export { A, B } from '...'  /  export * from '...'
        m = line.match(/^export\s+(\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/);
        if (m) {
            const what = m[1].replace(/\s+/g, ' ').trim();
            result.reexports.push(`${what} from '${m[2]}'`);
        }
    }

    return result;
}

const files = [...walk(SRC), ...walk(EXAMPLES)];
const byFile = new Map();
for (const f of files) {
    const parsed = parseFile(f);
    const empty = !parsed.classes.length && !parsed.functions.length && !parsed.consts.length && !parsed.reexports.length;
    if (!empty) byFile.set(relative(ROOT, f), parsed);
}

// Group by top-level src subdirectory (core, modules, vfx, utils, examples…).
const groups = new Map();
for (const id of [...byFile.keys()].sort()) {
    const parts = id.split('/'); // src/<group>/... or examples/<name>/...
    const group = parts[0] === 'examples' ? 'examples' : parts[1] || 'src';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
}

const GROUP_ORDER = ['core', 'modules', 'vfx', 'utils', 'examples'];
const orderedGroups = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});

let md = '';
md += '# API digest\n\n';
md +=
    'Terse public-surface index of `src/` for navigation: read a file’s API ' +
    'without opening it. Exported classes (with public method signatures), ' +
    'functions, consts, and barrel re-exports. Private (`_`-prefixed) methods ' +
    'and accessors omitted. Auto-generated — regenerate with ' +
    '`node scripts/build-api-digest.mjs`. Pairs with AGENTS.md (rationale) and ' +
    'module-graph.json (import edges).\n';

let totalClasses = 0;
let totalFns = 0;
for (const group of orderedGroups) {
    md += `\n## ${group}\n`;
    for (const id of groups.get(group)) {
        const p = byFile.get(id);
        md += `\n### ${id}\n`;
        for (const c of p.classes) {
            totalClasses++;
            md += `- **class ${c.name}**${c.extends ? ` extends ${c.extends}` : ''}\n`;
            for (const meth of c.methods) md += `  - ${meth}\n`;
        }
        for (const fn of p.functions) {
            totalFns++;
            md += `- fn \`${fn}\`\n`;
        }
        if (p.consts.length) md += `- const ${p.consts.map((c) => `\`${c}\``).join(', ')}\n`;
        for (const re of p.reexports) md += `- re-export ${re}\n`;
    }
}

writeFileSync(join(ROOT, 'api-digest.md'), md);
console.log(`api-digest.md: ${byFile.size} files, ${totalClasses} classes, ${totalFns} functions`);
