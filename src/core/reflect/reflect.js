// Node can't import this bare specifier (the package's `main` is a CJS build in a
// type:module package); Vite resolves its `module` field.
import { WgslReflect, ResourceType } from 'wgsl_reflect';

// WGSL → data definitions, via wgsl_reflect. The shape matches what callers
// already read (it was webgpu-utils' `makeShaderDataDefinitions`):
//   { structs, uniforms, storages, storageTextures, textures, externalTextures,
//     samplers, entryPoints: { name: { stage, resources: [{ name, group, entry }] } } }
// uniforms/storages/… are keyed by variable name: { typeDefinition, group, binding, size }.
// A type definition is one of
//   intrinsic { size, type }                     ('f32', 'vec3f', 'mat4x4<f32>', …)
//   array     { size, elementType, numElements } (numElements 0 = runtime-sized)
//   struct    { fields: { name: { offset, type } }, size, offset }

const STAGES = { vertex: 1, fragment: 2, compute: 4 }; // GPUShaderStage bits

// wgsl_reflect rejects these as identifiers (naga and Tint accept them).
// Renamed in the parser's copy only, then restored in reflected names.
const PARSER_RESERVED = ['block'];
const RENAME = (n) => `${n}__ogpu`;

export function reflect(code) {
    const renamed = PARSER_RESERVED.reduce((s, n) => s.replace(new RegExp(`\\b${n}\\b`, 'g'), RENAME(n)), code);
    const r = new WgslReflect(renamed);
    const nameOf = (n) => {
        for (const w of PARSER_RESERVED) if (n === RENAME(w)) return w;
        return n;
    };

    const structs = Object.fromEntries(r.structs.map((s) => [nameOf(s.name), structDef(s, 0, nameOf)]));
    const named = (vars) =>
        Object.fromEntries(
            vars.map((v) => {
                const typeDefinition = variableType(v, nameOf);
                return [
                    nameOf(v.name),
                    {
                        typeDefinition,
                        group: v.group,
                        binding: v.binding,
                        size: typeDefinition.size,
                    },
                ];
            })
        );

    const isExternal = (v) => v.type.name === 'texture_external';
    const entryPoints = {};
    for (const [stage, bit] of Object.entries(STAGES)) {
        for (const fn of r.entry[stage]) {
            entryPoints[nameOf(fn.name)] = {
                stage: bit,
                // @location inputs (vertex attributes for a vertex entry point)
                inputs: fn.inputs.filter((i) => i.locationType === 'location').map((i) => ({ name: nameOf(i.name), location: i.location })),
                resources: fn.resources.map((res) => ({
                    name: nameOf(res.name),
                    group: res.group,
                    entry: layoutEntry(res, bit),
                })),
            };
        }
    }

    return {
        externalTextures: named(r.textures.filter(isExternal)),
        samplers: named(r.samplers),
        structs,
        storages: named(r.storage.filter((v) => v.resourceType === ResourceType.Storage)),
        storageTextures: named(r.storage.filter((v) => v.resourceType === ResourceType.StorageTexture)),
        textures: named(r.textures.filter((v) => !isExternal(v))),
        uniforms: named(r.uniforms),
        entryPoints,
    };
}

function variableType(v, nameOf) {
    switch (v.resourceType) {
        case ResourceType.Uniform:
        case ResourceType.Storage:
        case ResourceType.StorageTexture:
            return typeDef(v.type, 0, nameOf);
        default:
            return { size: 0, type: v.type.name };
    }
}

function structDef(info, offset, nameOf) {
    const fields = Object.fromEntries(info.members.map((m) => [nameOf(m.name), { offset: m.offset, type: typeDef(m.type, 0, nameOf) }]));
    return { fields, size: info.size, offset };
}

function typeDef(info, offset, nameOf) {
    if (info.isArray) {
        return {
            size: info.size,
            elementType: typeDef(info.format, offset, nameOf),
            numElements: info.count,
        };
    }
    if (info.isStruct) return structDef(info, offset, nameOf);
    // template = vec4<f32>, mat4x4<f16>, atomic<u32>
    const type = info.isTemplate && info.format ? `${info.name}<${info.format.name}>` : info.name;
    return { size: info.size, type };
}

// --- bind group layout entries (one per resource, per entry point) ---

function sampleType(type) {
    if (type.name.includes('depth')) return 'depth';
    switch (type.format?.name) {
        case 'f32':
            return 'float';
        case 'i32':
            return 'sint';
        case 'u32':
            return 'uint';
        default:
            throw new Error(`unknown texture sample type for ${type.name}`);
    }
}

function viewDimension(type) {
    const n = type.name;
    if (n.includes('2d_array')) return '2d-array';
    if (n.includes('cube_array')) return 'cube-array';
    if (n.includes('3d')) return '3d';
    if (n.includes('1d')) return '1d';
    if (n.includes('cube')) return 'cube';
    return '2d';
}

const STORAGE_ACCESS = { read: 'read-only', write: 'write-only', read_write: 'read-write' };

function layoutEntry(res, visibility) {
    const { binding, access, type } = res;
    switch (res.resourceType) {
        case ResourceType.Uniform:
            return {
                binding,
                visibility,
                buffer: { ...(res.size && { minBindingSize: res.size }) },
            };
        case ResourceType.Storage:
            return {
                binding,
                visibility,
                buffer: {
                    type: access === '' || access === 'read' ? 'read-only-storage' : 'storage',
                    ...(res.size && { minBindingSize: res.size }),
                },
            };
        case ResourceType.Texture:
            if (type.name === 'texture_external') {
                return { binding, visibility, externalTexture: {} };
            }
            return {
                binding,
                visibility,
                texture: {
                    sampleType: sampleType(type),
                    viewDimension: viewDimension(type),
                    multisampled: type.name.includes('multisampled'),
                },
            };
        case ResourceType.Sampler:
            // 'non-filtering' can't be derived — it depends on the texture bound later
            return {
                binding,
                visibility,
                sampler: { type: type.name.endsWith('_comparison') ? 'comparison' : 'filtering' },
            };
        case ResourceType.StorageTexture: {
            const storageAccess = STORAGE_ACCESS[type.access];
            if (!storageAccess) throw new Error(`unknown storage texture access ${type.access}`);
            return {
                binding,
                visibility,
                storageTexture: {
                    access: storageAccess,
                    format: type.format.name,
                    viewDimension: viewDimension(type),
                },
            };
        }
        default:
            throw new Error(`unsupported resource type for '${res.name}'`);
    }
}
