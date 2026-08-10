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
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.scratch/**',
      '**/.probe/**',
      '**/.scratchprobe/**',
      'captures/**',
      'reports/**',
    ],
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
    // The browser verifiers ship callbacks to `page.evaluate`, so their source
    // legitimately contains browser code alongside its Node code.
    files: ['tools/verify-layout.mjs', 'tools/verify-drag.mjs', 'tools/verify-webkit.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
        getComputedStyle: 'readonly',
        Image: 'readonly',
      },
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
    // The bots are consumed by the browser AND by Node, so they carry the
    // engine's platform rules. The extra rule is the one ticket 10 exists to
    // protect: a policy sees a PlayerView, never the truth. Importing GameState
    // is how that boundary would erode, so it fails the build here as well as
    // in the source probe in @gp/sim.
    files: ['packages/bots/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@gp/engine',
              importNames: ['GameState'],
              message:
                'A policy sees PlayerView, never GameState. A bot that knows the deck order ' +
                'contaminates every balance number.',
            },
          ],
          patterns: [
            {
              group: ['react', 'react-*', '@gp/ui', '@gp/ui/*', '@gp/sim', '@gp/sim/*'],
              message: 'The bots run in the browser and in Node. No framework, no simulator.',
            },
            {
              group: ['node:*', 'fs', 'path', 'os', 'crypto', 'child_process'],
              message: 'The bots run in the browser. Do I/O in @gp/sim or @gp/ui.',
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
