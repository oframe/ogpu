// Internal WGSL reflection (wgsl_reflect underneath): data definitions, struct
// views and bind-group-layout derivation for Shader, RenderPipeline, ComputeShader.
export { reflect } from './reflect.js';
export { StructView, makeStructuredView, setStructuredView } from './StructView.js';
export { bindGroupLayoutDescriptors } from './layout.js';
