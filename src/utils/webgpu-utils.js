// The one importer of 'webgpu-utils' (ESLint enforces it). Module requests
// evaluate in source order: the shim defines Float16Array before the library
// builds its tables, the unshim removes it after.
import './float16-shim.js';
export * from 'webgpu-utils';
import './float16-unshim.js';
