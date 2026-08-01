/**
 * @gp/engine - the Greener Pastures rules engine.
 *
 * Framework-free TypeScript. No DOM, no Node, no React, no I/O. The browser UI
 * and the headless simulator both consume this package unchanged, so anything
 * platform-specific belongs in @gp/ui or @gp/sim, never here.
 *
 * The state model and move protocol follow wayfinder ticket 04; the card
 * handler API, task vocabulary and difficulty schema follow ticket 05, which
 * proved them against a spanning set of the hardest cards. The full
 * newGame / legalMoves / apply surface subsumes the runtime entry points when
 * the turn flow and the bulk card build land.
 */

export const ENGINE_VERSION = '0.1.0';

/** Rules edition this engine implements. Bumped when the design version moves. */
export const RULES_EDITION = 'v14';

export * from './state.js';
export { seedRng, rngNext, rngInt, shuffle } from './rng.js';
export type { RngState } from './rng.js';
export * from './query.js';
export { Fx, fireHook, wireHookBus } from './fx.js';
export type { CardInPlay, FxAudit, HookEvents, HookName } from './fx.js';
export { workWorker, advanceWorker } from './workers.js';
export type { WorkOptions } from './workers.js';
export { taskAnswers, resolveTask, drainTasks } from './tasks.js';
export { handlerFor, registeredCards } from './handlers/registry.js';
export type { CardHandler, CardMove, CustomTask, Difficulty } from './handlers/types.js';
export {
  cloneState,
  growBuilding,
  visitWork,
  workOwnWorker,
  standingMoves,
  applyCardMove,
  answerTask,
  pendingAnswers,
  gameEndScores,
} from './runtime.js';
export type { Applied, ScoreBreakdown } from './runtime.js';
export * as testkit from './testkit.js';
