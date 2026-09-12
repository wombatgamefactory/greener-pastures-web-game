/**
 * THE FIVE DOORS: is this action legal for this seat right now?
 *
 * Dean's standing ruling - a board whose action you cannot legally perform is
 * not offered - is why this asks every main action's enumerator.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { canSowOnto, drawableSuits, player, workerData } from '../query.js';
import type { CardId, DoorAction, GameState, Seat } from '../state.js';
import type { GameData, SuitDoor, WorkerAction } from '@gp/data';
import { anyBuildOption } from './build.js';
import { anyBalloonMoveOption, anyDeliverOption } from './deliver.js';
import { growOptions } from './grow.js';
import { harvestOptions } from './harvest.js';
import { withoutFirst } from './shared.js';

// --- The five doors: shared action legality --------------------------------

/**
 * Can this DOOR's action do anything for this seat right now? Reuses the same
 * enumerators the action funnels enforce, so a door is never offered and then
 * wedged. `excludingHandCard` re-checks as if a card - the visit fee - had
 * already left the hand.
 *
 * ⚠️ THE GATE AND THE ACTION MUST BE HANDED THE SAME MODIFIERS. This is one
 * function gating three call sites (`visitOptions`, `doVisit`, `meepleOptions`)
 * and one mismatch is never local: for a few hours on 19/08/2026 the harvest
 * branch asked the strict full gate while the door it gated ran a relaxed one,
 * so a visitor whose only target was a 2-of-3 building was told the door had
 * nothing legal to do. In v31 the doors are PLAIN, which removes every modifier
 * that could disagree - but the rule survives the reason for it.
 *
 * ⭐ RULED (v31): A DOOR THAT CAN DO NOTHING IS NOT OFFERED. `workers.json`
 * flags this as an open question - "whether a door should ever refuse a visitor
 * who cannot use it" - and the engine rules it refuses. The visit costs a card
 * and returns an action, so a visit whose action is a no-op is a strictly
 * dominated move: no player would take it, and offering it would bloat every
 * bot's move list with choices it has to price and reject. It became a live case
 * in v31 rather than a rare one, because the plain doors no longer carry riders
 * that mostly applied. ⚠️ It has a cost worth knowing: a seat can be locked out
 * of the bonus slot's interaction half entirely (every board clogged, or every
 * door dead for them), which is what `bonusDraw` exists to backstop.
 */
export function workerActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  workerId: string,
  opts?: { excludingHandCard?: CardId; excludingHandCard2?: CardId },
): boolean {
  return doorActionLegal(data, state, seat, workerData(data, workerId).action, opts);
}

/**
 * The same gate keyed on the ACTION rather than on a roster id, because the
 * commons buys one action the roster does not name (GROW, C3).
 *
 * `workerActionLegal` above is this function with the roster lookup in front of
 * it and is still the only way the two visit routes ask the question; the
 * commons asks here, through `commonsDoorAction`. One switch, so a door can
 * never be offered by one route and refused by the other.
 */
export function doorActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  action: DoorAction,
  /**
   * ⭐ `excludingHandCard2` IS THE WILD PAIR'S SECOND FEE (K3, 10/09/2026) and
   * nothing else ever sets it. Two optional fields rather than one `CardId[]`,
   * because every shipped call site passes exactly one card and must keep
   * passing one: an array would rewrite four call sites and both visit routes
   * for a knob that ships off.
   */
  opts?: { excludingHandCard?: CardId; excludingHandCard2?: CardId },
): boolean {
  const door = doorForAction(data, action);
  const withoutFee = opts?.excludingHandCard
    ? withoutFirst(player(state, seat).hand, opts.excludingHandCard)
    : player(state, seat).hand;
  const hand = opts?.excludingHandCard2
    ? withoutFirst(withoutFee, opts.excludingHandCard2)
    : withoutFee;
  switch (action) {
    case 'draw':
      return drawableSuits(data, state).length > 0;
    case 'harvest':
      return harvestOptions(data, state, seat).length > 0;
    case 'sow':
      // The Apiary door sows FROM THE HAND (v31), so it needs a card as well as
      // a target - which is exactly why it is the weakest door on the table:
      // two cards out, one threshold step in. `from: 'deck'` is the ruled fix if
      // the board takes no traffic, and this branch already handles it.
      // ⚠️ `canSowOnto` AND NOT `canTakeCard` (S11, 10/09/2026): a sow may
      // never choose a Notice Board under the notice-board visit, so the gate
      // and `sowTargets` have to ask the same question or a door is offered
      // with nothing to do. Identical to `canTakeCard` in every other game.
      return door.sow?.from === 'deck'
        ? drawableSuits(data, state).length > 0 &&
            player(state, seat).tableau.some((b) => canSowOnto(data, b))
        : hand.length > 0 && player(state, seat).tableau.some((b) => canSowOnto(data, b));
    case 'build':
      return anyBuildOption(data, state, seat, hand);
    case 'grow':
      // ⭐ THE COMMONS APIARY BOARD (C3). The Grow ACTION's own enumerator, with
      // the fee taken out of the hand first - which is what `excludeHandCard`
      // is for, and why it had to be added to `GrowOptionMods`: a hand of one
      // card cannot both pay the board and pay the activation.
      return (
        growOptions(data, state, seat, {
          ...(opts?.excludingHandCard === undefined
            ? {}
            : { excludeHandCard: opts.excludingHandCard }),
          ...(opts?.excludingHandCard2 === undefined
            ? {}
            : { excludeHandCard2: opts.excludingHandCard2 }),
        }).length > 0
      );
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
      return anyDeliverOption(data, state, seat) || anyBalloonMoveOption(data, state, seat);
    default:
      return action satisfies never;
  }
}

/**
 * The roster entry behind a door action. GROW has no entry of its own - it is
 * the commons re-reading the Apiary board's printed SOW (C3) - so it borrows
 * that one; the only thing `doorActionLegal` reads off an entry is the sow's
 * size and source, which a Grow never asks about.
 *
 * By ACTION rather than by id: the two happen to be spelled the same in
 * `workers.json` today and nothing should depend on their staying that way.
 */
function doorForAction(data: GameData, action: DoorAction): SuitDoor {
  const wanted: WorkerAction = action === 'grow' ? 'sow' : action;
  const door = data.workers.roster.find((w) => w.action === wanted);
  if (!door) throw new Error(`No door in the roster performs ${wanted}`);
  return door;
}
