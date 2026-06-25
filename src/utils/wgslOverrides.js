// Safari WebGPU does not yet support pipeline-overridable constants
// (`override` in WGSL + the `constants` pipeline descriptor field). Bake the
// values straight into the source as module-scope `const` declarations before
// compiling, so we never hand `constants` to the pipeline descriptor.
//
// Handles:
//   @id(0) override NAME: TYPE = DEFAULT;
//   override NAME: TYPE = DEFAULT;
//   override NAME: TYPE;            (must be supplied in `constants`)
//   override NAME = DEFAULT;        (type inferred)
//
// A constant whose value is absent falls back to its WGSL default expression.
// Default expressions that reference earlier overrides or module-scope consts
// are resolved to numeric literals when possible, so the baked output never
// contains non-literal initialiser expressions that confuse webgpu-utils'
// WGSL parser (which errors with "Invalid cast" on unresolvable identifiers).

const OVERRIDE_RE = /(?:@id\s*\(\s*\d+\s*\)\s*)?override\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_][\w<>]*))?\s*(?:=\s*([^;]+?))?\s*;/g;

// Match module-scope `const NAME [: TYPE] = EXPR;` declarations.
const CONST_RE = /^\s*const\s+([A-Za-z_]\w*)\s*(?::[^=]*)?\s*=\s*([^;]+?)\s*;/gm;

function formatValue(value, type) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';

    const t = type || '';
    if (t === 'i32' || t === 'u32') return String(Math.trunc(value));
    if (t === 'f32' || t === 'f16') {
        return Number.isInteger(value) ? value.toFixed(1) : String(value);
    }
    // no explicit type — abstract int stays abstract; float gets concrete f32 suffix
    if (Number.isInteger(value)) return String(value);
    return String(value) + 'f';
}

// Strip WGSL numeric-type suffixes (e.g. 4u → 4, 1.0f → 1.0) then evaluate
// a simple arithmetic expression. Returns a JS number, or undefined if the
// expression contains unresolved identifiers or unsafe characters.
function tryEvalExpr(expr) {
    const cleaned = expr.replace(/\b(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[uifh]\b/g, '$1');
    if (/[a-zA-Z_]/.test(cleaned)) return undefined; // unresolved idents
    if (/[^0-9\s+\-*/%^()|&<>.!~]/.test(cleaned)) return undefined; // unsafe chars
    try {
        const val = Function('"use strict"; return (' + cleaned + ')')();
        return typeof val === 'number' && isFinite(val) ? val : undefined;
    } catch {
        return undefined;
    }
}

// Substitute known identifier names into `expr` using word-boundary replacement.
function resolveExpr(expr, resolved) {
    let result = expr;
    for (const [name, val] of Object.entries(resolved)) {
        result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val));
    }
    return result;
}

export function applyOverrideConstants(code, constants = {}) {
    // Pre-populate resolved values from module-scope `const` declarations already
    // in the source (e.g. `const BOUNDS_HALO = 0;`) so they can be substituted
    // into override default expressions.
    const resolved = {};
    for (const [, name, expr] of code.matchAll(CONST_RE)) {
        const val = tryEvalExpr(expr.trim());
        if (val !== undefined) resolved[name] = val;
    }

    return code.replace(OVERRIDE_RE, (match, name, type, def) => {
        const hasValue = constants[name] !== undefined && constants[name] !== null;

        let valueStr;
        if (hasValue) {
            const val = constants[name];
            if (typeof val === 'number') resolved[name] = val;
            valueStr = formatValue(val, type);
        } else if (def !== undefined) {
            const substituted = resolveExpr(def.trim(), resolved);
            const evaluated = tryEvalExpr(substituted);
            if (evaluated !== undefined) {
                // All references resolved — bake a plain literal
                if (typeof evaluated === 'number') resolved[name] = evaluated;
                valueStr = formatValue(evaluated, type);
            } else {
                // Still has unresolvable references — emit the (partially) substituted form
                valueStr = substituted;
            }
        } else {
            console.error(`[wgslOverrides] override '${name}' has no default and no value supplied`);
            return match;
        }

        return type ? `const ${name}: ${type} = ${valueStr};` : `const ${name} = ${valueStr};`;
    });
}
