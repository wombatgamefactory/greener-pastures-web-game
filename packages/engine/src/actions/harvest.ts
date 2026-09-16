/**
 * HARVEST: one of your full buildings.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import { isHarvestable, player } from '../query.js';
import type { CardId, GameState, Seat } from '../state.js';
import type { GameData } from '@gp/data';

// --- Harvest ---------------------------------------------------------------

/**
 * ⛔ THE WHEAT RELAXED-HARVEST GATE LEFT THIS FILE ON 19/08/2026 AND LEFT THE
 * GAME IN v31. It is worth two paragraphs because it moved twice.
 *
 * `WHEAT_RELAXED_MIN` and `wheatRelaxedMin` stood here and made "harvest a
 * building with 2+ cards even if it is not full" a property of the WHEAT SEAT.
 * On 19/08/2026 Dean confirmed the sheet had deliberately swapped W2 and W3's
 * powers and the engine had them the wrong way round, so the relaxation became
 * the Wheat DOOR's action - belonging to whoever WORKED that door rather than to
 * whoever owned it, which was the first time the suit's signature verb had been
 * rentable. In v31 the doors are PLAIN: every enhancement the doors carried is
 * gone, because a door now buys a whole core action for one card and stacking a
 * rider on top of it was pricing a sweetener into a deal that no longer needed
 * one.
 *
 * So a Wheat seat's Harvest is the strict printed rule like everybody else's,
 * and the only relaxations left in the game are the ones a CARD prints for
 * itself (W11, W12).
 */

/**
 * The Harvest ACTION's targets: FULL buildings, and since v31 that is the whole
 * of the printed rule for every seat by every route.
 *
 * `relaxedMin` unions in any building at or above that many cards even when it
 * is not full, and the two gates genuinely cross - a threshold-1 building is
 * strict-harvestable at 1 card but never relaxed-harvestable at a floor of 2.
 *
 * ⚠️ NOTHING PASSES A FLOOR ANY MORE. The Wheat door did until v31 (via the
 * `chooseBuilding` task's `relaxedMin` rider, which the 'harvestable' filter
 * still routes through). The parameter stays because the printed exceptions need
 * the same union, and because a gate and the
 * action it gates must be handed the SAME modifiers - a mismatch here refused a
 * perfectly legal harvest for a few hours on 19/08/2026 and was not local, it
 * reached five call sites.
 */
export function harvestOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  /**
   * Buildings holding at least this many cards are harvestable even when NOT
   * full. `Infinity` (the default) is the plain printed rule: full only.
   */
  relaxedMin: number = Infinity,
): CardId[] {
  // ⚠️ `isHarvestable` AND NOT `isFull` SINCE 10/09/2026, and the two stopped
  // being the same boolean that day (S8, see `query.thresholdShuts`). This is
  // the HARVEST question - is the stack at or above its threshold - where
  // `isFull` now answers the CLOG question, and a `3+` Notice Board is
  // harvestable at three cards while never clogging at all. Asking `isFull`
  // here would have made the owned Notice Board unharvestable under the arm,
  // which is the whole of the host's payment (S7).
  const own = player(state, seat)
    .tableau.filter((b) => isHarvestable(data, b) || b.stack.length >= relaxedMin)
    .map((b) => b.card);
  return own;
}

/**
 * ⛔ `harvestAgainPower` AND THE WHOLE ActionAgain MACHINERY ARE GONE (v31).
 *
 * It was the upgraded Wheat Farmstead's "Harvest is 2 buildings": one optional
 * repeat of the Harvest ACTION, armed after the main action only and never after
 * a door's, held open by `turn.again`. The Wheat rebalance took the repeat off
 * the card on 2026-08-12 because Wheat came in first at 50.0% against an even
 * share of 36.4% and a free extra action on the suit's own core verb was the
 * largest single term in it; the Dairy "you may BUILD again" had already gone on
 * 2026-08-10 for the same reason at twice the price.
 *
 * It was left standing as a dead stub on the explicit grounds that ripping it
 * out changed the `GameState` shape and moved the serialisation and view tests,
 * which was noise inside a balance arm. v31 changes that shape anyway and the
 * arm is long since measured, so this is that separate commit: `turn.again`, the
 * repeat branch in `apply`, the hold in `settleTurn` and the `endTurn` decline
 * all go with it. Nothing in the catalogue has produced it for three weeks.
 *
 * ⚠️ IT IS NOT KNOB-CONTROLLED, which is the difference between this deletion
 * and the one `settleTurn` refuses to make. A branch whose only producer is a
 * card that no longer exists is dead; a branch whose only producer is a knob at
 * its shipped value is a control arm, and deleting it silently deletes the
 * measurement.
 */

export function doHarvestAction(fx: Fx, seat: Seat, building: CardId): void {
  if (!harvestOptions(fx.data, fx.state, seat).includes(building)) {
    throw new Error(`${building} is not harvestable by seat ${seat}`);
  }
  fx.harvest(seat, building);
}
