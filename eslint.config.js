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
    // Disable ESLint stylistic rules that conflict with Prettier — keep last.
    prettier,
];
