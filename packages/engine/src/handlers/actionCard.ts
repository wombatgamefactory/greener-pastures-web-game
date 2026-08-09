/**
 * The two lines every Tier 3 ACTION card shares.
 *
 * An ACTION card prints no threshold and no activation type, so it can be
 * neither grown nor sown; it offers a standing MOVE instead, and that move IS
 * the main action. Written once here because the Wheat rebuild (W13/W14/W15)
 * and the Orchard rebuild (O13/O14/O15) landed the same shape four months
 * apart, and a third suit will want it too.
 *
 * The action SPEND is deliberately not here: `applyMove` sets
 * `turn.actionSpent` before it does anything else, so a handler that forgets is
 * visibly wrong rather than quietly relying on a helper.
 */

import type { GameState } from '../state.js';
import type { CardMove } from './types.js';

/**
 * A Tier 3 ACTION card's standing move, when it has something to do.
 *
 * One move, never one per option: where the action needs choices (which
 * building, which deck) the choices are pushed as tasks from `applyMove`. The
 * Helping Hand enumerates one move per fee card because the fee IS the
 * decision; these are not that shape.
 */
export function actionMove(self: { seat: number; card: string }, live: boolean): CardMove[] {
  if (!live) return [];
  return [{ type: 'cardMove', seat: self.seat, card: self.card, kind: 'action', payload: {} }];
}

/** Every ACTION card gates the same way: your turn, the main action unspent. */
export function actionOpen(state: GameState, self: { seat: number }): boolean {
  return state.turnPlayer === self.seat && !state.turn.actionSpent;
}
