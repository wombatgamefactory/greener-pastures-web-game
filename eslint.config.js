import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The load-bearing rule in here is the engine import boundary. @gp/engine has to
 * run unchanged in a browser and in Node, so it may not reach for React, the DOM
 * or Node built-ins. Three things enforce that, deliberately overlapping:
 *
 *   1. packages/engine/package.json declares no dependency except @gp/data,
 *      which is platform-free by the same rules (ticket 04: every engine
 *      function takes the overlay-applied GameData as an argument).
 *   2. packages/engine/tsconfig.json omits the "DOM" lib and all @types, so
 *      `document` or `process` fail typecheck.
 *   3. the no-restricted-imports block below, which catches the rest.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.scratch/**', 'reports/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build and repo-hygiene scripts. Plain JS, so they get no Node globals from
    // @types/node the way the TypeScript packages do.
    files: ['tools/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', '@gp/ui', '@gp/ui/*', '@gp/sim', '@gp/sim/*'],
              message:
                'The engine must stay framework-free and depend on no other workspace package.',
            },
            {
              group: ['node:*', 'fs', 'path', 'os', 'crypto', 'child_process'],
              message:
                'The engine must run in the browser. Do I/O in @gp/sim or @gp/ui and pass data in.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gp/sim', '@gp/sim/*'],
              message: 'The UI does not depend on the simulator.',
            },
          ],
        },
      ],
    },
  },
);
