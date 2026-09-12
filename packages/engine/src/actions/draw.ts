/**
 * DRAW: two cards, keep both.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import type { Seat } from '../state.js';

// --- Draw ------------------------------------------------------------------

/**
 * The plain Draw ACTION: `rules.turn.baseDraw`, which is see 2 KEEP 2 since v31.
 *
 * ⭐ THE DRAW KEEPS BOTH CARDS AND DISCARDS NOTHING. It was see 2 keep 1 from
 * v13 until v31, and the change is not generosity: the discard was the last
 * piece of hidden bookkeeping in the core five actions and it bought nothing
 * measurable. The task machinery is unchanged - it is still the see-N/keep-K
 * task - so a `see > keep` card ability still opens a real choice; it is only
 * the printed action that no longer has one.
 *
 * ⚠️ WATCH THE INTERACTION WITH `bonusDraw`. The plain action and the free bonus
 * option are now the same verb at two sizes, so a seat that takes Draw as its
 * action and Draw 1 as its bonus nets three cards a turn with no interaction at
 * all. That is the shape action inflation shows up in first.
 *
 * No draw modifier is consulted: the Orchard Farmstead's `withDrawModifier` went
 * with the suit powers (v31), so the printed numbers are the numbers.
 */
export function doDraw(fx: Fx, seat: Seat): void {
  const { see, keep } = fx.data.rules.turn.baseDraw;
  fx.pushTask({ t: 'draw', pid: seat, src: null, see, keep, revealed: [] });
}
