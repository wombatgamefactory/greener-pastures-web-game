/**
 * The turn boundary. No explicit state machine: what the reference spreads
 * over nine states is derived from (tasks, turn flags, phase). settleTurn runs
 * after every apply - it ends the turn the moment the action is spent and
 * nothing optional remains, so bots never need a filler move, and the explicit
 * endTurn move exists only to decline options that are still live.
 */

import type { GameData } from '@gp/data';

import { handLimitOf, harvestOptions, hasBuyOption } from './actions.js';
import type { Fx } from './fx.js';
import { player } from './query.js';
import { standingMoves } from './runtime.js';
import { freshTurn } from './setup.js';
import type { GameState } from './state.js';

/**
 * Advance the turn if there is nothing left for the player to decide. Called
 * with a drained (or never-filled) task queue; a pushed discard task suspends
 * the boundary and the next settle completes it.
 */
export function settleTurn(data: GameData, draft: GameState, fx: Fx): void {
  if (draft.phase !== 'playing' || draft.tasks.length > 0) return;
  const turn = draft.turn;
  if (!turn.ending) {
    if (!turn.actionSpent) return;
    // An armed ActionAgain repeat with a live target holds the turn open,
    // exactly like an unspent bonus slot; with no target it lapses silently.
    if (turn.again === 'harvest' && harvestOptions(data, draft, draft.turnPlayer).length > 0) {
      return;
    }
    // An unspent BONUS SLOT no longer holds the turn open, and cannot: since
    // 19/08/2026 the slot is start-of-turn only, so by the time we are past the
    // `!turn.actionSpent` guard above, `bonusOpen` is already false and
    // `hasBonusOption` is false with it. The check that used to live here was
    // therefore not removed as tidying - it had become unreachable, and the
    // turn now settles the moment the action and its tails are done.
    //
    // The free card buy DID hold the turn open the same way, which is why a
    // seat holding coins used to end its turn by DECLINING rather than by
    // running out of things to do. `buyCost` is null as of the same date, so
    // `hasBuyOption` is constant false; the call stays because the knob is
    // reversible in one line and this is the seam that would have to come back
    // with it.
    if (hasBuyOption(data, draft, draft.turnPlayer)) return;
    if (standingMoves(data, draft, draft.turnPlayer).length > 0) return;
    turn.ending = true;
    turn.visit = null;
  }
  finishTurn(data, draft, fx);
}

/**
 * The NextPlayer checkpoint: discard to the printed Barn hand size, advance
 * the seat, and end the game when the seat about to play is the end-trigger
 * player again (every other player has then had exactly one more turn).
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
}
