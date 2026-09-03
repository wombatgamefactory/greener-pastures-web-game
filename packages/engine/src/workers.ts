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

import type { Suit } from '@gp/data';

import { doorOf } from './query.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import type { Seat } from './state.js';

/** What paid for this door action: a card on a Notice Board, or a meeple leaving the game. */
export type DoorVia = 'visit' | 'meeple';

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
  fx.emit({ e: 'doorUsed', seat: actor, colour, action: door.action, via });

  switch (door.action) {
    case 'draw': {
      // Draw 3, keep 3 - see the exception note above. No draw modifier is
      // consulted: `withDrawModifier` went with the Orchard Farmstead (v31), so
      // the printed numbers are the numbers.
      const spec = door.draw ?? { see: 1, keep: 1 };
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
      door.action satisfies never;
  }

  // Fires for both routes. It used to carry `owner` (who collected the wage) and
  // `free` (the Herb Hive's off-the-books use); both described an economy that
  // no longer exists, so the payload says what happened instead of who was paid.
  fireHook(fx, 'afterWork', { actor, colour, action: door.action, via });
}
