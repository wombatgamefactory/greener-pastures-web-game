/**
 * HARVEST: one of your full buildings, OR the whole pile from a central board.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import {
  commonsBoardCard,
  commonsBoards,
  commonsHarvestMin,
  hasCentre,
  isHarvestable,
  player,
} from '../query.js';
import type { CardId, GameState, Seat } from '../state.js';
import type { GameData } from '@gp/data';
import { commonsHarvestReachesCentre } from '@gp/data';

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
 * itself (W11, W12) plus the magenta balloon's "harvest any building, even if it
 * is not full".
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
 * still routes through). The parameter stays because the balloon's `harvestAny`
 * and the printed exceptions need the same union, and because a gate and the
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
  // ⭐ AND, UNDER THE COMMONS, EVERY CENTRAL PILE DEEP ENOUGH TO TAKE (C5).
  // Not your buildings and not anybody's: a pile with a card on it is
  // harvestable by whoever's turn it is, into THEIR barn, and the whole pile
  // comes.
  //
  // ⭐ "DEEP ENOUGH" IS ONE CARD UNLESS `commonsHarvestMin` SAYS OTHERWISE
  // (Dean, 09/09/2026). At null - the shipped rule - the gate is >= 1 and this
  // is byte-identical to the rule as ruled; a number n imports the BUILDING
  // semantic into the centre, so a pile is "full" at n and refuses a harvest
  // below it. `commonsHarvestTake` is the other half of the same question and
  // lives in `fx.harvest`, because it changes what comes out rather than
  // whether anything may.
  //
  // ⭐ INCLUDING THE PILE YOU JUST FED THIS TURN, which is Dean's ruling and
  // not an accident of ordering: the commons play lands the fee BEFORE the
  // action it buys, so buying a Harvest through the wheat board can take back
  // the card that paid for it plus everything under it. "A good turn, not a
  // loop" - the fee is only ever ONE card and the pile it joins is whatever the
  // table left there.
  //
  // ⚠️ `relaxedMin` IS IRRELEVANT HERE (D2). A central pile has no threshold,
  // so it is never "not full"; the magenta balloon's harvest-any and the plain
  // action see exactly the same central targets, and the union above is where
  // the two gates still differ for BUILDINGS.
  // ⭐ TWO GAMES HAVE A CENTRE SINCE 11/09/2026, AND A HARVEST IS A HARVEST IN
  // BOTH (D1, reaffirmed by Dean that day, in his words "to prevent any rules
  // exceptions"). The commons puts all five piles in the middle; Dean's
  // unclaimed-boards variant puts the unfarmed suits' boards there and leaves
  // the rest as owned buildings. The gate is the same either way and so is the
  // minimum, which is why this reads `hasCentre` rather than growing a second
  // branch: the variant's overlay pins `commonsHarvestMin` to 3, so a pile
  // below three may be taken by nobody and a pile at three or more by ANYBODY.
  if (!hasCentre(data)) return own;
  // ⭐ DEAN'S VARIANTS: HARVEST NEVER REACHES THE CENTRE AT ALL under any
  // `commonsTake` value but the shipped `'harvest'`. Under 'bonus', 'spend'
  // and 'paid' (09/09/2026) a central pile is taken by the `commonsTake` bonus
  // move instead - to hand, to barn or per-board (D-S4); under 'coins'
  // (10/09/2026, K4, reversing C5) it is DISCARDED for one coin per card and
  // nothing playable comes back at all. In every one of the four the Harvest
  // action stops at own full buildings, commonsHarvestMin and
  // commonsHarvestTake have no subject, and the farm-bypass share reads 0% BY
  // CONSTRUCTION - which is why this returns before either knob is read.
  //
  // ⭐ ONE HELPER RATHER THAN A DISJUNCTION THAT GROWS BY ONE TERM PER VARIANT
  // (10/09/2026). `commonsHarvestReachesCentre` is written in @gp/data against
  // the shipped value, so a FIFTH `commonsTake` gets this rule right by
  // default instead of by somebody remembering to widen an `||` in two files.
  if (!commonsHarvestReachesCentre(data)) {
    return own;
  }
  return [...own, ...centralHarvestTargets(data, state)];
}

/**
 * ⭐ EVERY CENTRAL PILE DEEP ENOUGH FOR ANYBODY TO TAKE, as board card ids.
 *
 * Split out of `harvestOptions` on 11/09/2026 because a SECOND route now needs
 * exactly the same set: the Wheat Notice Board's power, which Dean ruled must
 * reach the centre under the unclaimed-boards variant "to prevent any rules
 * exceptions". A second copy of the depth test in `tasks.ts` is how a gate and
 * the action it gates come to disagree, which this file has already paid for
 * once (19/08/2026, five call sites).
 *
 * ⛔ IT WALKS `centralBoardSuits` AND NOT `data.cards.suits`. Under the commons
 * those are the same five; under the variant only the unfarmed suits have a
 * pile at all, and a colour with no board must not be offered as a pile of zero
 * - `commonsBoardCard` would happily hand back a card id that is sitting in a
 * rival's tableau.
 *
 * ⚠️ `relaxedMin` HAS NO SUBJECT HERE (D2). A central pile has no threshold, so
 * it is never "not full": the magenta balloon's harvest-any and the plain action
 * see exactly the same central targets, and the only gate is
 * `commonsHarvestMin`.
 */
export function centralHarvestTargets(data: GameData, state: GameState): CardId[] {
  if (!hasCentre(data) || !commonsHarvestReachesCentre(data)) return [];
  const boards = commonsBoards(state);
  const min = commonsHarvestMin(data);
  const out: CardId[] = [];
  // ⚠️ ONE WALK AND ONE ARRAY, RATHER THAN `centralBoardSuits().filter().map()`.
  // This runs through `hasMainOption` on every settle and through the bots'
  // speculative applies on top of that, and three throwaway arrays a call is
  // exactly the per-decision allocation ticket 28 went hunting for. An ABSENT
  // pile is a board that is not in the centre at all (a seat is farming that
  // suit); an EMPTY one is a board with nothing on it, and `>= min` refuses it
  // anyway - but the two are still checked separately, because conflating them
  // is how a rival's board would come to be offered as a harvest target.
  for (const colour of data.cards.suits) {
    const pile = boards[colour];
    if (pile === undefined || pile.length < min) continue;
    out.push(commonsBoardCard(data, colour));
  }
  return out;
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
