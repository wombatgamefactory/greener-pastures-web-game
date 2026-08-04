import { execFileSync } from 'node:child_process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

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

/**
 * The wombatgamefactory.com analytics stack: the CookieYes consent banner, then
 * the GA4 tag, in that order because consent has to be able to gate the tag.
 * Same measurement id as the site, so the game reports into the same property.
 *
 * Two deliberate narrowings, both so the reports mean what they say:
 *
 *  - `apply: 'build'` keeps the tag out of the dev server and out of every
 *    vitest run.
 *  - the localhost guard keeps it out of `vite preview` and `verify:layout`,
 *    which serve a real production build on this machine. The loader script
 *    sends nothing on its own; it is `gtag('config', ...)` that opens the
 *    session, so withholding that is enough.
 *
 * The events those hits are paired with live in `src/session/analytics.ts`.
 */
const GA_MEASUREMENT_ID = 'G-FNNQF917JJ';
const COOKIEYES_SRC =
  'https://cdn-cookieyes.com/client_data/b4b72588ac323168ef2bca929b5e5cd9/script.js';

function analytics(): Plugin {
  return {
    name: 'gp-analytics',
    apply: 'build',
    // `pre` so the consent banner lands ahead of the app's own script tags, as
    // it does on the site. The app bundle is a deferred module and would run
    // after these classic scripts either way, but the head should read in the
    // order things actually matter.
    transformIndexHtml: {
      order: 'pre' as const,
      handler: () => [
        {
          tag: 'script',
          attrs: { id: 'cookieyes', type: 'text/javascript', src: COOKIEYES_SRC },
          injectTo: 'head' as const,
        },
        {
          tag: 'script',
          attrs: {
            async: true,
            src: `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`,
          },
          injectTo: 'head' as const,
        },
        {
          tag: 'script',
          children: [
            'window.dataLayer = window.dataLayer || [];',
            'function gtag(){dataLayer.push(arguments);}',
            "gtag('js', new Date());",
            'if (!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname))',
            ` gtag('config', '${GA_MEASUREMENT_ID}');`,
          ].join('\n'),
          injectTo: 'head' as const,
        },
      ],
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  define: { __APP_VERSION__: JSON.stringify(buildId()) },
  plugins: [react(), analytics()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
