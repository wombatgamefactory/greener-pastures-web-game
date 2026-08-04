import { execFileSync } from 'node:child_process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, so the built asset URLs need
// that prefix. Local dev and `vite preview` serve from the root.
const REPO_BASE = '/greener-pastures-web-game/';

/**
 * The build id a bug report is stamped with (ticket 31). A capture taken on the
 * live Pages build is worth much less without it: the engine version is
 * hand-bumped and will sit at 0.1.0 for months, so the commit is the only thing
 * that says which code produced the bug.
 *
 * Never fatal. A tarball with no .git is a legitimate way to build.
 */
function buildId(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  define: { __APP_VERSION__: JSON.stringify(buildId()) },
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
