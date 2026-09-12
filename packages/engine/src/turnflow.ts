/**
 * The turn boundary. No explicit state machine: what the reference spreads
 * over nine states is derived from (tasks, turn flags, phase). settleTurn runs
 * after every apply - it ends the turn the moment the action is spent and
 * nothing optional remains, so bots never need a filler move, and the explicit
 * endTurn move exists only to decline options that are still live.
 *
 * THE v31 TURN, in the order it is played:
 *
 *   1. spend any number of MEEPLES, one at a time, each performing its colour's
 *      plain action and then leaving the game for good;
 *   2. ONE bonus option - Draw 1, or place a card on any Notice Board;
 *   3. ONE core action - Draw, Build, Grow, Harvest, Deliver.
 *
 * Steps 1 and 2 are both start-of-turn, and both are gated inside the
 * `!turn.actionSpent` early return below rather than by a phase field: there is
 * no other thing a turn can have done, so the whole ordering needs two
 * predicates (`meepleSpendOpen`, `bonusOpen`) and no new state. A meeple may not
 * be held back and spent later, which `meepleSpendOpen`'s second clause
 * enforces under `'start'`.
 *
 * ⭐ **AND SINCE 12/09/2026 THE MEEPLE PHASE CAN SIT AT THE OTHER END OF THE
 * TURN** (`rules.turn.meepleSpendTiming: 'afterAction'`, M4, ledger A151, the
 * delivery meeple). Under it step 1 moves BELOW step 3: after your main action
 * you may discard one meeple for the PLAIN action of its colour, and D7 makes
 * that legal on any turn once the action window has closed, PASSED included.
 *
 * ⚠️ **NOTHING IN THIS FILE HAD TO CHANGE FOR IT, AND THAT IS WORTH
 * SAYING RATHER THAN LEAVING TO BE REDISCOVERED.** The `!turn.actionSpent` early
 * return is the window's own opening condition read from the other side: under
 * `'afterAction'` `meepleOptions` is empty by construction until the action is
 * spent, and non-empty exactly when the line below must hold the turn open. The
 * gate that was written for the start-of-turn phase is the same gate the
 * end-of-turn one needs, and `endTurn` (offered whenever the action is spent) is
 * how a seat declines.
 */

import type { GameData } from '@gp/data';

import { bonusOpen, handLimitOf, hasBonusOption, meepleOptions } from './actions.js';
import type { Fx } from './fx.js';
import { player } from './query.js';
import { standingMoves } from './runtime.js';
import { freshTurn } from './setup.js';
import type { GameState, Seat } from './state.js';

/**
 * Advance the turn if there is nothing left for the player to decide. Called
 * with a drained (or never-filled) task queue; a pushed overflow-discard task
 * suspends the boundary and the next settle completes it.
 */
export function settleTurn(data: GameData, draft: GameState, fx: Fx): void {
  if (draft.phase !== 'playing' || draft.tasks.length > 0) return;
  const turn = draft.turn;
  if (!turn.ending) {
    if (!turn.actionSpent) return;
    // ⛔ THE ActionAgain HOLD IS GONE (v31). It kept the turn open for the
    // upgraded Wheat Farmstead's optional second Harvest. Its only producer was
    // a card that stopped existing on 2026-08-12, and no knob restores it - see
    // the tombstone on `harvestAgainPower` in actions.ts for why that makes it a
    // different case from the line below.
    //
    // ⛔ THE MEEPLE PHASE NEEDS NO HOLD EITHER, and the reason is the same
    // `!turn.actionSpent` return above: meeples are spendable only before the
    // action, so by the time this line is reached `meepleOptions` is empty by
    // construction. `meepleOptions` is imported and asserted below rather than
    // ignored, because "empty by construction" is exactly the kind of claim that
    // silently stops being true.
    //
    // An unspent BONUS SLOT holds the turn open. ⭐ SINCE 03/09/2026 THIS LINE
    // IS LOAD-BEARING UNDER THE SHIPPED RULES, not dead weight: `bonusTiming`
    // is 'end', so the slot OPENS when the action is spent and this is the only
    // thing standing between a seat and a turn that ends before its bonus is
    // offered. Under the old 'start' rule it was unreachable, which is exactly
    // the trap described below.
    //
    // ⚠️ IT WAS DEAD ONLY WHILE THE KNOB SAID SO, WHICH IS WHY IT IS HERE.
    // It was deleted on 19/08/2026 as "unreachable, not merely redundant", and
    // that reasoning is correct for `bonusTiming: 'start'` and false for both
    // other states of that same knob - including the one now shipped. Under
    // `overlays/bonus-any-time.overlay.json` the slot reopens after the action,
    // `bonusOpen` returns true - and with no check here the turn settled anyway,
    // so the bonus was never offered and the overlay changed NOTHING. The arm
    // run on 19/08/2026 came back with an exactly zero delta on all eleven
    // metrics and all fourteen assertions, which is the signature of an inert
    // knob rather than of a rule that does not matter. A deletion justified by
    // the shipped value of a knob silently deletes that knob's control arm; if
    // the timing is ever made a constant, delete this line THEN - and note that
    // the constant would now have to be 'end', under which it must NEVER go.
    if (bonusOpen(data, draft) && hasBonusOption(data, draft, draft.turnPlayer)) return;
    // The same knob reopens the meeple phase, because `meepleSpendOpen` reads
    // `bonusUsed` under `'start'` and a late bonus leaves it empty. One line,
    // same reasoning.
    //
    // ⭐ AND SINCE 12/09/2026 IT IS THE DELIVERY MEEPLE'S ONLY GATE (M4).
    // Under `meepleSpendTiming: 'afterAction'` this list is non-empty precisely
    // when the action is spent and a spendable meeple is held, so this line is
    // the whole of what holds the turn open for the new window. It was already
    // written and already load-bearing, which is the second time the note above
    // it has paid for itself.
    //
    // ⭐ UNDER THE MEEPLE-LOOP ARM THIS LINE IS INERT BY CONSTRUCTION, and it
    // must be: the turn-start meeple spend is DELETED (R8), so `meepleOptions`
    // returns [] the moment `rules.turn.visitCurrency` is 'meeple' and the turn
    // is never held open for a phase that no longer exists. The gate is left in
    // place rather than made conditional, on exactly the reasoning above it -
    // deleting a line because the shipped knob value makes it unreachable is
    // how the bonus check came to be deleted on 19/08/2026 and had to come back.
    if (meepleOptions(data, draft, draft.turnPlayer).length > 0) return;
    // ⛔ The free card BUY held the turn open here too, which is why a seat
    // holding coins used to end its turn by DECLINING rather than by running out
    // of things to do. The buy and the currency are both gone (v31).
    if (standingMoves(data, draft, draft.turnPlayer).length > 0) return;
    turn.ending = true;
  }
  finishTurn(data, draft, fx);
}

/**
 * The NextPlayer checkpoint: discard down to the hand limit, advance the seat,
 * and end the game when the seat about to play is the end-trigger player again
 * (every other player has then had exactly one more turn).
 *
 * ⭐ THE DISCARD IS BACK (Dean, 02/09/2026), and it is the ONLY place the hand
 * limit is enforced. That is the rule, not an implementation detail: you may
 * hold as many cards as you like DURING your turn, and several cards need you to
 * - O14 sows a whole hand and then draws 4, W10 empties one into the barn - so a
 * mid-turn check would break them. The ceiling applies once, here, at the moment
 * your turn ends.
 *
 * It is also the one place in the turn boundary that can SUSPEND: it pushes a
 * `discard` task, sets `resume: 'turnflow'` and returns, and the next settle
 * runs the boundary again from the top. Anything added below this line must
 * survive being reached on a second pass.
 *
 * ⚠️ THE COST OF THIS BRANCH IS C(hand, excess), enumerated in `taskAnswers`.
 * It is bounded only because the hand it reads was itself bounded by the
 * previous turn's pass through here - so the discard cannot be relaxed without
 * re-measuring the branching factor. See `subsets` in actions.ts.
 */
function finishTurn(data: GameData, draft: GameState, fx: Fx): void {
  const seat = draft.turnPlayer;
  const limit = handLimitOf(data, draft, seat);
  if (limit !== null && player(draft, seat).hand.length > limit) {
    fx.pushTask({ t: 'discard', pid: seat, downTo: limit });
    draft.resume = 'turnflow';
    return;
  }
  const next = (seat + 1) % draft.seats;
  fx.emit({ e: 'turnEnded', seat, next });
  if (draft.endTrigger !== null && next === draft.endTrigger.seat) {
    draft.phase = 'ended';
    fx.emit({ e: 'gameEnded' });
    return;
  }
  draft.turnPlayer = next;
  draft.turn = freshTurn();
  clearHostDrawLatch(draft, next);
}

/**
 * ⭐ THE HOST-DRAW CAP RESETS HERE, AND THIS LINE IS THE WHOLE RULE
 * (`rules.turn.hostDrawCapPerRound`, 11/09/2026).
 *
 * The capped quantity is "one payment between a host's OWN turns", so the latch
 * is cleared for the seat whose turn is BEGINNING and for nobody else. Every
 * other seat keeps whatever it has taken since its own last turn.
 *
 * ⛔ **IT IS NOT PART OF `freshTurn()` AND MUST NEVER BE FOLDED INTO IT.**
 * `freshTurn` replaces `TurnState`, which is scoped to the turn being played and
 * would therefore cap the VISITOR - a cap that bites only when one visitor sends
 * two visits to one host in a single turn (two seats alone, via A Helping Hand)
 * and leaves four seats, the only breaching seat count, untouched.
 *
 * ⚠️ Written against the field rather than through `hostDrewThisRound` in
 * query.ts on purpose: the accessor THROWS on a missing latch, and this runs on
 * every turn boundary of every game including the ones with no latch at all.
 * The `undefined` check is the "cap is off" case and is not a silent failure.
 */
function clearHostDrawLatch(draft: GameState, seat: Seat): void {
  const p = draft.players[seat];
  if (p !== undefined && p.hostDrewThisRound !== undefined) p.hostDrewThisRound = false;
}
