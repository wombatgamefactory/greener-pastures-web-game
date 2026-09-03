/**
 * The worker thread's first two lines, and the only reason they exist is that a
 * worker does not always inherit its parent's TypeScript loader.
 *
 * Under `tsx` (how the CLI runs) it does, and `register` here is a no-op. Under
 * vitest it does NOT - vitest transforms modules itself and a raw worker thread
 * has no idea how to parse a .ts file - so the determinism test could not spawn
 * a worker at all until this file registered tsx explicitly.
 *
 * It is .mjs on purpose: it is the one file in the chain that must be loadable
 * with no loader in place.
 */
try {
  const api = await import('tsx/esm/api');
  api.register();
} catch {
  // Already registered by the parent, or tsx is not installed in this context.
  // Either way the import below is the real test of whether TS can be loaded.
}
await import('./worker.ts');
