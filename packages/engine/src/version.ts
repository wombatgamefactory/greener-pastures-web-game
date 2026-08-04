/**
 * The two version stamps, in a module of their own so anything inside the
 * engine can read them without importing the package root.
 *
 * `capture.ts` is the reason: a capture envelope stamps both, and importing
 * `index.js` from a module `index.js` re-exports is a cycle.
 */

export const ENGINE_VERSION = '0.1.0';

/** Rules edition this engine implements. Bumped when the design version moves. */
export const RULES_EDITION = 'v14';
