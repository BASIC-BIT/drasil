import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginJest from 'eslint-plugin-jest';
import prettier from 'eslint-plugin-prettier';

// Config for JavaScript config files must come first to prevent TypeScript parser from being used on them
const configs = [
  // Config for JavaScript config files
  {
    files: ['*.js', '*.cjs', '.*.js', '.*.mjs', '.*.cjs'],
    ignores: ['dist/**', 'build/**'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'commonjs', // Use commonjs for .js config/script files
    },
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': 'warn',
      'no-duplicate-imports': 'warn',
    },
  },
  // Config for Node.js scripts in scripts/ directory
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node, // Enable Node.js global variables
      },
      sourceType: 'commonjs', // Specify CommonJS module system
    },
    plugins: {
      prettier,
    },
    rules: {
      // Add any script-specific rule overrides here if needed
      'prettier/prettier': 'warn',
    },
  },
  // Base config for all TypeScript files
  {
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', 'test/**/*', 'dist/**/*'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier,
    },
    rules: {
      'prettier/prettier': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      'no-duplicate-imports': 'warn',
    },
  },
  // Base JavaScript recommended config
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ignores: ['dist/**/*'],
    plugins: { js },
    extends: ['js/recommended'],
  },
  // Test files config
  {
    files: [
      '**/*.spec.ts',
      '**/*.test.ts',
      'test/**/*.ts',
      '**/__mocks__/**/*.ts',
      '**/__tests__/**/*.*',
    ],
    ignores: ['dist/**/*'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...pluginJest.environments.globals.globals,
      },
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.test.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier,
      jest: pluginJest,
    },
    rules: {
      'prettier/prettier': 'warn',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/prefer-to-have-length': 'warn',
      'jest/valid-expect': 'error',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      'no-duplicate-imports': 'warn',
    },
  },
];

export default defineConfig(configs);
