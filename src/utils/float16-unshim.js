// The library has captured the stub in its tables; app code keeps seeing no
// Float16Array (a feature check stays honest, `new Float16Array` still throws).
import { float16Shimmed } from './float16-shim.js';

if (float16Shimmed) delete globalThis.Float16Array;
