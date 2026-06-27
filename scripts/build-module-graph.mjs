#!/usr/bin/env node
// Emits module-graph.json: static import graph of src/ for agent navigation.
// Nodes = files / ?raw shaders / external packages; edges = imports; each node
// carries in/out-degree (high in-degree = hub). Dep-free; aliases mirror
// vite.config.js. Run: node scripts/build-module-graph.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Repo-relative id, always POSIX-separated so the graph is identical on Windows.
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const EXAMPLES = join(ROOT, 'examples');

// Mirror vite.config.js / jsconfig.json aliases.
const ALIASES = {
    '@core/': 'src/core/',
    '@modules/': 'src/modules/',
    '@utils/': 'src/utils/',
    '@examples/': 'examples/',
    '@/': 'src/',
};

// Extensions tried when a specifier omits one, plus index resolution.
const EXTS = ['', '.js', '.mjs', '.wgsl'];
const INDEX = ['index.js', 'index.mjs'];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|mjs)$/.test(name)) out.push(full);
    }
    return out;
}

// Pull every static/dynamic import specifier from a source file.
function extractSpecifiers(code) {
    const specs = [];
    const patterns = [
        /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, // import x from '...'
        /import\s*['"]([^'"]+)['"]/g, //               import '...'
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //      import('...')
        /export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, //  export ... from '...'
    ];
    for (const re of patterns) {
        let m;
        while ((m = re.exec(code))) specs.push(m[1]);
    }
    return specs;
}

// Resolve a specifier to a repo-relative file id, or {external} for packages.
function resolveSpecifier(spec, fromFile) {
    const raw = spec.replace(/\?.*$/, ''); // strip ?raw etc.

    let basePath = null;
    if (raw.startsWith('.')) {
        basePath = resolve(dirname(fromFile), raw);
    } else {
        for (const [alias, target] of Object.entries(ALIASES)) {
            if (raw.startsWith(alias)) {
                basePath = join(ROOT, target, raw.slice(alias.length));
                break;
            }
        }
    }

    // Bare specifier with no alias match => external package.
    if (basePath === null) return { external: true, id: raw.split('/')[0] };

    for (const ext of EXTS) {
        const candidate = basePath + ext;
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            return { id: rel(candidate) };
        }
    }
    for (const idx of INDEX) {
        const candidate = join(basePath, idx);
        if (existsSync(candidate)) return { id: rel(candidate) };
    }
    // Unresolved (e.g. asset not on disk) — keep as a best-effort node.
    return { id: rel(basePath), unresolved: true };
}

function typeForId(id) {
    if (id.endsWith('.wgsl')) return 'shader';
    return 'module';
}

const files = [...walk(SRC), ...walk(EXAMPLES)];
const nodes = new Map(); // id -> node
const edges = [];

function ensureNode(id, type) {
    if (!nodes.has(id)) nodes.set(id, { id, type, inDegree: 0, outDegree: 0 });
    return nodes.get(id);
}

for (const file of files) {
    const id = rel(file);
    ensureNode(id, 'module');
    const code = readFileSync(file, 'utf8');
    const seen = new Set();
    for (const spec of extractSpecifiers(code)) {
        const res = resolveSpecifier(spec, file);
        const targetId = res.external ? `pkg:${res.id}` : res.id;
        if (seen.has(targetId)) continue; // dedupe multi-import from same module
        seen.add(targetId);
        ensureNode(targetId, res.external ? 'external' : typeForId(targetId));
        edges.push({ from: id, to: targetId });
    }
}

// Degree counts.
for (const e of edges) {
    nodes.get(e.from).outDegree++;
    nodes.get(e.to).inDegree++;
}

const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

const graph = {
    description:
        'Static module dependency graph of src/ for agent navigation. nodes: source files (module), ?raw shaders (shader), packages (external). edges: imports. inDegree = import hubs. Regenerate via scripts/build-module-graph.mjs.',
    stats: {
        nodes: nodeList.length,
        edges: edges.length,
        modules: nodeList.filter((n) => n.type === 'module').length,
        shaders: nodeList.filter((n) => n.type === 'shader').length,
        external: nodeList.filter((n) => n.type === 'external').length,
    },
    // Highest in-degree internal modules = hubs.
    hubs: nodeList
        .filter((n) => n.type !== 'external')
        .sort((a, b) => b.inDegree - a.inDegree)
        .slice(0, 12)
        .map((n) => ({ id: n.id, inDegree: n.inDegree })),
    nodes: nodeList,
    edges,
};

const outPath = join(ROOT, 'module-graph.json');
writeFileSync(outPath, JSON.stringify(graph, null, 2) + '\n');
console.log(`module-graph.json: ${graph.stats.nodes} nodes, ${graph.stats.edges} edges ` + `(${graph.stats.modules} modules, ${graph.stats.shaders} shaders, ${graph.stats.external} external)`);
