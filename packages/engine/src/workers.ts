/**
 * THE FIVE DOORS: performing a suit's action.
 *
 * `workers.json` says what each suit's action IS, and since v31 exactly two
 * things read it - a NOTICE BOARD grants that action to whoever places a card on
 * it, and a MEEPLE of that colour performs the same action free when its owner
 * spends it. Same five entries, same five actions, two ways in, so there is one
 * dispatch here and both routes come through it.
 *
 * ⛔ WHAT LEFT THIS FILE, IN THE ORDER IT LEFT. The Working Week track's advance,
 * wage and expiry arithmetic went with the Hiring Fair (2026-08-10). The wage
 * itself went with the currency (v31), and with it the standing law it enforced
 * - that you never earn from your own farm - because in v31 the owner places a
 * card on their own board exactly as a rival does and there is nothing to earn.
 * `workWorker` and its `WorkOptions.progress` flag went at the same time:
 * `progress: false` was the Herb Hive's off-the-books mode, where the action
 * happened but no card was placed and no wage was minted, and neither half of
 * that sentence describes anything that still exists.
 *
 * ⭐ THE DOORS ARE PLAIN, AND THAT IS THE v31 CHANGE. Every enhancement the
 * roster used to carry - the relaxed harvest, the hand card into the barn before
 * a delivery, the deck-sown card, the build at a discount with crop requirements
 * waived - is gone, because the bonus slot itself became the enhancement: a door
 * now buys a WHOLE CORE ACTION for one card, which is a far bigger prize than
 * any rider was, and stacking a rider on top was pricing a sweetener into a deal
 * that no longer needed one. The `draw` and `sow` blocks survive only because
 * those two actions need a size.
 */

import type { GameData, Suit } from '@gp/data';
import { doorActionForSuit, isMeepleCurrency } from '@gp/data';

import { doorOf } from './query.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import type { DoorAction, Seat } from './state.js';

/**
 * What paid for this door action: a card on a rival's Notice Board, a meeple
 * leaving the supply, or - since 09/09/2026 - a card played onto a CENTRAL board
 * (C3). Three routes, one dispatch, exactly as the first two have been since
 * v31: `via` says what paid and nothing below it branches on the answer.
 */
export type DoorVia = 'visit' | 'meeple' | 'commons';

/**
 * ⭐ WHAT A COLOUR'S DOOR BUYS, WHICH IS NOT ALWAYS WHAT `action` PRINTS.
 *
 * Under the commons the Apiary board buys **GROW** - pay the building's
 * activation card into its stack and gain the ability - where the roster's
 * `action` prints SOW, and Dean's reason is worth keeping: a sow through the
 * door cost a visitor two cards for one threshold step (the self-cancellation
 * bite), and the commons fee is a third card on top of it. A Grow is the same
 * placement with the ability attached, so the weakest door in the game becomes a
 * real one at the same price.
 *
 * The override is DATA (`workers.roster.sow.actionUnderCommons`, C3), read
 * through the data package's own `doorActionForSuit` so the engine, the bots and
 * the sim cannot disagree about what a board buys. It is a second payload beside
 * `action` rather than an edit to it, so `overlays/v31-card-visit` and
 * `overlays/meeple-loop-v1` keep their Sow door without pinning anything.
 *
 * Throws rather than defaulting, exactly as `doorOf` does: a colour with no door
 * is a corrupt roster and not a state a caller should be handling.
 */
export function doorActionOf(data: GameData, colour: Suit): DoorAction {
  const action = doorActionForSuit(data, colour);
  if (action === undefined) throw new Error(`No door action for suit ${colour}`);
  return action;
}

/**
 * Perform a suit's door action as `actor`.
 *
 * RULING (locked, carried over unchanged since v13): SUIT POWERS APPLY TO
 * ACTIONS PERFORMED THROUGH A DOOR OR BY A MEEPLE. It is your action, whoever's
 * premises it is taken on and whatever wooden thing paid for it. In v31 there
 * are no Farmstead suit powers left for that ruling to reach, but it still
 * governs anything a CARD grants, so the branches below push the same tasks the
 * core actions push and nothing here is a second implementation of an action.
 *
 * ⚠️ THE ONE EXCEPTION IN THE SET IS THE ORCHARD DOOR AT DRAW 3, AND IT IS
 * LOAD-BEARING. The self-cancellation law: a visitor pays 1 card to use a door,
 * so a door whose action PRODUCES cards has to over-deliver or buying it is net
 * zero. The bonus slot's other option is a free Draw 1, so a plain Draw 2 door
 * would cost 1 card and return 2 - exactly what the free option gives for
 * nothing - and would be STRICTLY WORSE than its own alternative. Draw 3 nets
 * +2. Tidy it to 2 for consistency with the other four and the Orchard door dies
 * overnight, and it will die silently: nothing errors, the traffic simply goes
 * somewhere else.
 *
 * `colour` is looked up in `workers.roster` and never in `state.fair`, because a
 * meeple of a suit NOBODY is farming still works.
 */
export function performDoorAction(fx: Fx, actor: Seat, colour: Suit, via: DoorVia): void {
  const door = doorOf(fx.data, colour);
  // The commons re-reads one of the five (Apiary sow becomes GROW, C3); under
  // both controls this is exactly `door.action`.
  const action = doorActionOf(fx.data, colour);
  fx.emit({ e: 'doorUsed', seat: actor, colour, action, via });

  switch (action) {
    case 'draw': {
      // Draw 3, keep 3 - see the exception note above. No draw modifier is
      // consulted: `withDrawModifier` went with the Orchard Farmstead (v31), so
      // the printed numbers are the numbers.
      // ⭐ THE ORCHARD EXCEPTION IS CURRENCY-DEPENDENT (the meeple-loop arm,
      // R2). Draw 3 exists only because a card visit has to beat a free Draw 1;
      // under the meeple currency a visit costs no card and there is no
      // standalone free Draw, so the door is the plain Draw 2 the other four
      // doors are equivalents of. A SECOND printed payload rather than an
      // overwrite, so the shipped 3/3 cannot move when the arm does.
      // ⭐ THE COMMONS READS THE PRINTED `draw`, WHICH IS 2/2 SINCE 09/09/2026
      // (C3: Dean chose Draw 2 over Draw 3, with `commons-draw-three` as the
      // paired arm). No third payload and no branch: the data pass moved the
      // printed number, the meeple arm keeps its own second payload, and the
      // v31 control is the one game that ever wanted a 3 here.
      const spec = (isMeepleCurrency(fx.data) ? door.drawUnderMeepleCurrency : undefined) ??
        door.draw ?? { see: 1, keep: 1 };
      fx.pushTask({
        t: 'draw',
        pid: actor,
        src: null,
        see: spec.see,
        keep: spec.keep,
        revealed: [],
      });
      break;
    }
    case 'harvest':
      // The PLAIN Harvest: full buildings only. The `relaxedMin` rider this used
      // to pass ("2 or more cards, even if not full") was printed on the Wheat
      // Notice Board and travelled with the action to whoever worked the door;
      // v31's flat doors deleted it.
      fx.pushTask({
        t: 'chooseBuilding',
        pid: actor,
        src: null,
        filter: 'harvestable',
        then: 'harvest',
      });
      break;
    case 'sow':
      // ⚠️ FROM THE HAND, AND THIS IS THE WEAKEST DOOR ON THE TABLE (Dean,
      // 02/09/2026, ruled that way knowingly). A visitor pays 1 card onto the
      // board and a SECOND card into the sow, for one threshold step on one of
      // their own buildings: two cards out for one step in, which is the
      // self-cancellation law biting on the one door where it was not paid off.
      // The fix, if the Apiary board takes no traffic, is `from: 'deck'` in the
      // data - not a cheaper door - and this branch already handles it.
      if (door.sow?.from === 'deck') {
        fx.pushTask({ t: 'sowFromDeck', pid: actor, src: null, remaining: door.sow.amount });
      } else {
        fx.pushTask({ t: 'sow', pid: actor, src: null, remaining: door.sow?.amount ?? 1 });
      }
      break;
    case 'grow':
      // ⭐ THE COMMONS APIARY BOARD (C3), and the one door action with no
      // roster entry of its own. It reuses the main Grow action's own task
      // chain - one task, answers straight out of `growOptions`, resolved
      // through `doGrow` - so the ability fires through the same funnel a
      // played Grow does and nothing here is a second implementation. The
      // commons FEE is extra and has already left the hand by the time this
      // runs, which is why the enumerator prices the payment without it.
      // ⛔ NO CLOG BYPASS (C3): a card is placed, so a full building is not a
      // target. The meeple-paid Grow's bypass (R15) is a different rule and
      // there are no meeples here.
      fx.pushTask({ t: 'grow', pid: actor, src: null });
      break;
    case 'build':
      // The PLAIN Build: full cost, crop requirements apply. The Builder's Yard
      // used to waive the crops and take a card off the price; v31's flat doors
      // deleted both, so a visitor buying a Build buys the action and nothing
      // more.
      fx.pushTask({ t: 'build', pid: actor, src: null });
      break;
    case 'deliver':
      // The PLAIN Deliver, island or freight (a balloon move IS the Deliver
      // action, DL-12). The hand-card-into-the-barn head this used to queue
      // first was the door's rider and is gone.
      fx.pushTask({ t: 'deliver', pid: actor, src: null });
      break;
    default:
      action satisfies never;
  }

  // Fires for both routes. It used to carry `owner` (who collected the wage) and
  // `free` (the Herb Hive's off-the-books use); both described an economy that
  // no longer exists, so the payload says what happened instead of who was paid.
  fireHook(fx, 'afterWork', { actor, colour, action, via });
}
