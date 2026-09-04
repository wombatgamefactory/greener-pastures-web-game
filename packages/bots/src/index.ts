/**
 * @gp/bots - how a seat decides.
 *
 * A fourth platform-free package rather than a folder inside @gp/sim, because
 * the UI's difficulty ladder needs the same bots the balance runs use and the
 * UI may not depend on the simulator. It cannot live in @gp/engine either: the
 * engine has no opinion about how to play.
 *
 * The package-wide invariant, enforced by eslint and probed by a test in
 * @gp/sim: nothing in here imports `GameState`. A policy sees `PlayerView` and
 * nothing else, so no balance number can be contaminated by a bot that knows
 * the deck order.
 *
 * Designed in wayfinder ticket 10, built in ticket 28. The driver that walks a
 * game with these policies lives in @gp/sim - it needs GameState, which is
 * exactly what may not be in scope here.
 */

export const BOTS_VERSION = '0.1.0';

export type { ExplainedMove, Policy, PolicyContext } from './types.js';
export type { Act } from './acts.js';
export { actOf, spendSize } from './acts.js';
export { cardValue, lowestValueCard, totalValue } from './junk.js';
export { SUIT_STRENGTH, magpieTarget } from './magpie.js';
export {
  MEEPLE_AS_CARD_DOOR_PREMIUM,
  MEEPLE_AS_CARD_FLOOR,
  MEEPLE_AS_CARD_LIVE,
  MEEPLE_LATENT,
  cropOfView,
  handSpendCost,
  makeScratch,
  meepleWorth,
  thresholdOfView,
} from './scratch.js';
export { makeOutcomes, meanCardValue } from './outcome.js';
export {
  IGNORES_BUILD_PAYMENT,
  KEEPS_SPENT_CARDS,
  READS_BUILD_PAYMENT,
  narrowMoves,
  setNarrowing,
} from './narrow.js';
export type { Outcomes } from './outcome.js';
export type { Scratch } from './scratch.js';
export { TERMS, TERM_NAMES } from './terms.js';
export type { Term } from './terms.js';
export { BALANCED, PROFILES, checkWeightTable, weightsFor } from './weights.js';
export type { WeightTable } from './weights.js';
export { scoredPolicy } from './evaluator.js';
export { GREEDY_PRIORITY, greedy, pulse, random } from './simple.js';
export {
  BALANCE_PROFILES,
  HARD_TIER,
  LADDER,
  POLICY_IDS,
  isPolicyId,
  makePolicy,
  policyRng,
} from './roster.js';
export type { PolicyId } from './roster.js';
