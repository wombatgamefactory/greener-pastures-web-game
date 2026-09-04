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

export { ENGINE_VERSION, RULES_EDITION } from './version.js';

export * from './state.js';
export { seedRng, rngNext, rngInt, shuffle } from './rng.js';
export type { RngState } from './rng.js';
export * from './query.js';
export * from './actions.js';
export { Fx, fireHook, wireHookBus } from './fx.js';
export type { CardInPlay, FxAudit, HookEvents, HookName } from './fx.js';
export { performDoorAction } from './workers.js';
export type { DoorVia } from './workers.js';
export { taskAnswers, resolveTask, drainTasks } from './tasks.js';
export { handlerFor, registeredCards } from './handlers/registry.js';
// The two sub-type predicates the sim's per-suit metrics count with. Exported so
// the D1 / DL-42 rulings have ONE definition each and the sim cannot drift from
// the engine's.
export { isFieldCard } from './handlers/wheat.js';
export { isOrchardCard } from './handlers/orchard.js';
export { isHiveCard } from './handlers/apiary.js';
export type { CardHandler, CardMove, CustomTask, Difficulty } from './handlers/types.js';
export {
  cloneState,
  growBuilding,
  visitWork,
  standingMoves,
  applyCardMove,
  answerTask,
  pendingAnswers,
  gameEndScores,
  score,
  sameShape,
} from './runtime.js';
export type { Applied, GameScore, ScoreBreakdown } from './runtime.js';
export {
  newGame,
  islandTilesInPlay,
  demandPool,
  meeplePool,
  emptyMeeples,
  startingMeeples,
  freshNoticeBoard,
  meepleLoopPlayerFields,
  buildIsland,
  parkBalloons,
  freshTurn,
} from './setup.js';
export type { NewGameOptions } from './setup.js';
export { legalMoves, apply, isOver } from './game.js';
export { settleTurn } from './turnflow.js';
export {
  CAPTURE_FORMAT,
  makeCapture,
  captureFilename,
  parseCapture,
  describeCapture,
  replayCapture,
  replayFixture,
  toFixture,
} from './capture.js';
export type {
  Capture,
  CaptureInput,
  CaptureLabel,
  CaptureOrigin,
  CaptureSetup,
  CaptureUi,
  Fixture,
  ReplayOptions,
  ReplayResult,
  ReplayThrow,
} from './capture.js';
export { viewFor, redactEvents, maskCard } from './view.js';
export type { BuildingView, PlayerView, RivalView } from './view.js';
export { makeProber, newProbeBudget, PROBE_BUDGET } from './probe.js';
export type { Probe, ProbeBudget, Prober } from './probe.js';
export * as testkit from './testkit.js';
