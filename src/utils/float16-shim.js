// webgpu-utils 2.x reads Float16Array while its module loads (struct-view and
// vertex/texture format tables); Chrome/Edge 113–134 lack it and would fail at
// import. A distinct Uint16Array subclass, never an alias: the library keys a
// typed-array → vertex-format Map on constructors, and an alias would overwrite
// Uint16Array's entry (uint16 attributes would become float16). Not Float32Array
// either: f16 fields are 2 bytes wide. Stub views hold raw bits, not halves.
// Global only while the library loads — ./float16-unshim removes it again.
export const float16Shimmed = typeof globalThis.Float16Array === 'undefined';
export class Float16Stub extends Uint16Array {}
if (float16Shimmed) globalThis.Float16Array = Float16Stub;
