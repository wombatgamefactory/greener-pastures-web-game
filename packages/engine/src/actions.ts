/**
 * THE FIVE MAIN ACTIONS AND THE BONUS SLOT - now a barrel over actions/.
 *
 * The enumerators are the single source of legality. legalMoves maps them to
 * Moves, the Build/Deliver Worker tasks map them to task answers, and every
 * funnel re-validates the same predicates before mutating - so apply accepts
 * exactly what legalMoves offers, and a Worker performing an action obeys the
 * same rules as the action itself.
 *
 * ⛔ THE SUIT-POWER SEAMS ARE GONE (v31). All five Farmsteads print one end-game
 * scorer and nothing else, so the funnels are the plain printed actions and a
 * suit's identity lives entirely in its deck. Nothing here hardcodes a tunable
 * number - every dial reads from GameData.
 *
 * ## WHERE THINGS LIVE, SINCE 12/09/2026
 *
 * This file was 5,865 lines and about two thirds comment, and opening all of it
 * to change one action cost more than the change did. It is now ten modules
 * under `actions/`, split on the section banners it already had. **This file
 * re-exports exactly what it exported before, so nothing that imports it moved.**
 *
 *   actions/shared.ts ..... subsets, hand limit, barn tally, withoutFirst
 *   actions/meeples.ts .... the retired meeple-as-card arm (pinned control only)
 *   actions/build.ts ...... cost, payment enumeration, doBuild  <- widest branching
 *   actions/draw.ts ....... Draw 2, keep both
 *   actions/grow.ts ....... activation and targets
 *   actions/harvest.ts .... your full buildings OR a central pile
 *   actions/deliver.ts .... the island and its demand tokens
 *   actions/doors.ts ...... shared action legality
 *   actions/bonus.ts ...... the bonus slot, THE COMMONS, and the 'spend' variant
 *   actions/main.ts ....... hasMainOption
 *
 * ⚠️ THE SPLIT IS NOT ARBITRARY AND THE GROUPINGS ARE LOAD-BEARING. Run
 * `python tools/map-cycles.py packages/engine/src/actions.ts` on the old file and
 * it reports three real runtime cycles; two of them are inside `bonus.ts`, which
 * is why the bonus slot, the commons and the 'spend' variant share a module, and
 * the third is why `withoutFirst` sits in `shared.ts` rather than beside the
 * doors. **Do not "tidy" those apart without re-running that tool.**
 */

export { barnTally, freeHandSpace, handLimitOf, subsets, tileLevel } from './actions/shared.js';
export type { MeepleFill, MeeplePlacement, ResolvedPlacement } from './actions/meeples.js';
export {
  assertPlacementMatches,
  meepleAsCard,
  meepleCount,
  meepleFills,
  slotTollOf,
} from './actions/meeples.js';
export type { BuildMods, BuildOption } from './actions/build.js';
export {
  anyBuildOption,
  buildOptions,
  divertOrDiscard,
  doBuild,
  paymentOptions,
  placeBuilt,
} from './actions/build.js';
export { doDraw } from './actions/draw.js';
export type { DeckGrowOption, GrowOption, GrowOptionMods } from './actions/grow.js';
export { activateTargets, deckGrowOptions, growOptions, meeplePairs } from './actions/grow.js';
export { doHarvestAction, harvestOptions } from './actions/harvest.js';
export type { DeliverChoice, DeliverOption, DemandRef, TokenRef } from './actions/deliver.js';
export {
  anyDeliverOption,
  deliverAnswers,
  deliverOptions,
  doDeliver,
  islandDeliveriesBy,
  payableTileCount,
  tileHasRoom,
  tokenChoices,
  tokenSwapOptions,
} from './actions/deliver.js';
export { doorActionLegal, vegetableBoardCanDeliver, workerActionLegal } from './actions/doors.js';
export type { CollectOption, VisitOption, VisitSpend } from './actions/bonus.js';
export {
  anyVisitOption,
  bonusDrawOpen,
  bonusOpen,
  bonusSlotsFor,
  collectOpen,
  collectOptions,
  doBonusDraw,
  doCollect,
  doSpendMeeple,
  doVisit,
  hasBonusOption,
  meepleOptions,
  meepleSpendOpen,
  noticeBoardPowerLegal,
  visitOptions,
} from './actions/bonus.js';
export { hasMainOption } from './actions/main.js';
