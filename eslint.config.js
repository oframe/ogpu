import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'public/**'],
    },
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'examples/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.worker,
                // WebGPU + project-specific globals not in `globals.browser` yet
                GPUBufferUsage: 'readonly',
                GPUTextureUsage: 'readonly',
                GPUShaderStage: 'readonly',
                GPUMapMode: 'readonly',
                GPUColorWrite: 'readonly',
                GPUAdapter: 'readonly',
                GPUDevice: 'readonly',
                GPUBuffer: 'readonly',
                GPUTexture: 'readonly',
                GPUCanvasContext: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
            'no-undef': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
        },
    },
    {
        // Node-run tooling: build/lint scripts, asset tools, and config files.
        files: ['scripts/**/*.{js,mjs}', 'tools/**/*.{js,mjs}', '*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
        },
    },
    {
        files: ['**/*.{js,mjs}'],
        rules: {
            // src/math wraps wgpu-matrix with local fixes (quat.rotationTo's 180° turn);
            // @utils/webgpu-utils loads the Float16Array shim before webgpu-utils
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        { name: 'wgpu-matrix', message: "Import from '@math/functions' (or '@math'); src/math holds the local fixes." },
                        { name: 'webgpu-utils', message: "Import from '@utils/webgpu-utils'; it loads the Float16Array shim first." },
                    ],
                    patterns: [
                        { group: ['wgpu-matrix/*'], message: "Import from '@math/functions'." },
                        { group: ['webgpu-utils/*'], message: "Import from '@utils/webgpu-utils'." },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/math/functions/*.js', 'src/utils/webgpu-utils.js'],
        rules: { 'no-restricted-imports': 'off' },
    },
    // Disable ESLint stylistic rules that conflict with Prettier — keep last.
    prettier,
];
