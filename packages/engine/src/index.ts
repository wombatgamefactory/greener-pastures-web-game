/**
 * @gp/engine - the Greener Pastures rules engine.
 *
 * Framework-free TypeScript. No DOM, no Node, no React, no I/O. The browser UI
 * and the headless simulator both consume this package unchanged, so anything
 * platform-specific belongs in @gp/ui or @gp/sim, never here.
 *
 * The real state model, Move union, `legalMoves` and `apply` are designed in
 * wayfinder ticket 04. This file is the package boundary and nothing more.
 */

export const ENGINE_VERSION = '0.0.0';

/** Rules edition this engine implements. Bumped when the design version moves. */
export const RULES_EDITION = 'v14';
