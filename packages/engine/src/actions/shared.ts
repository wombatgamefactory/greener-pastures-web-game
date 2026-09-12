/**
 * Helpers with no action of their own: subset enumeration, the hand-limit and
 * barn queries, and the one-card drop used by every option enumerator.
 *
 * `withoutFirst` lives here rather than beside the doors because Grow needs it
 * and the doors need Grow: that single edge was the only cycle in the file.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { cardById, player } from '../query.js';
import type { CardId, GameState, Seat } from '../state.js';
import type { GameData, Suit } from '@gp/data';

/**
 * All k-card subsets, as a list. `k` is a build cost (at most 5 cards) or a hand
 * overflow; `items` is a hand.
 *
 * ⚠️ **WHAT BOUNDS THIS IS `rules.turn.handLimit`, AND NOTHING ELSE.** The
 * comment here used to say "hands are 6-8" as though that were a property of the
 * game. It was a property of ONE RULE - the hand limit - and when v31 deleted
 * that rule on 02/09/2026 this function silently became unbounded. It is
 * C(hand, k): at a hand of 33 and a cost of 4 that is 40,920 payments FOR ONE
 * BUILDABLE CARD, and the measured worst position offered 116,535 legal moves
 * and took a 2-seat game from about 0.1 seconds to minutes. The limit came back
 * the same day, at a flat 12, expressly to bound this - see
 * `RulesFile.turn.handLimit` for the full measurement.
 *
 * So: at the shipped limit of **7** (03/09/2026, down from 12) the worst payment
 * enumeration is C(6, 4) = 15, and it grows as C(limit - 1, 4) - 330 at 12, 70
 * at 9, 1 at 5. ANY CHANGE THAT LETS A HAND GROW PAST THE LIMIT - a new knob, a
 * card, a relaxation of the turn boundary - is a change to the branching factor
 * of the whole game, and belongs in a paired arm with the legal-move count read
 * off it.
 *
 * ⚠️ **THE WIDEST ENUMERATION IN THE GAME IS NO LONGER THIS ONE.** At a limit of
 * 7 the measured worst position offers 368 legal moves, and the widest single
 * answer list is the end-of-turn `discard` task at 330 - the OTHER C(n, k) in
 * the game, and the one that grows when a card effect stuffs a hand well past
 * the ceiling mid-turn. Whoever comes here next looking for the explosion should
 * look there first.
 */
export function subsets<T>(items: readonly T[], k: number): T[][] {
  // ⭐ REWRITTEN 03/09/2026, SAME OUTPUT, SAME ORDER, a third of the cost. The
  // previous body was the textbook two-line recursion - `[...subsets(rest, k-1)
  // .map(s => [head, ...s]), ...subsets(rest, k)]` - which builds and throws
  // away an intermediate array and a spread PER SUBTREE. A CPU profile of a
  // 2-seat game put 12.5% of the whole run inside this one function, more than
  // any other, and about half of that was allocation the answer never keeps.
  //
  // This walks index combinations in increasing order, which is EXACTLY the
  // order the recursion produced (subsets containing item 0 first, then those
  // without, applied recursively, is lexicographic by index). That equality is
  // load-bearing rather than tidy: enumeration order reaches the bots' tie-break
  // and the metric fold's `legal` list, so a reordering here would move balance
  // numbers without changing a single rule.
  const out: T[][] = [];
  if (k < 0 || k > items.length) return out;
  const pick: T[] = new Array<T>(k) as T[];
  const walk = (start: number, depth: number): void => {
    if (depth === k) {
      out.push(pick.slice());
      return;
    }
    // Stop early where too few items remain to finish the choice.
    const last = items.length - (k - depth);
    for (let i = start; i <= last; i++) {
      pick[depth] = items[i] as T;
      walk(i + 1, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

// --- shared queries --------------------------------------------------------

/**
 * THE HAND LIMIT: cards a seat may still be holding when its turn ENDS, or null
 * for no limit at all.
 *
 * ⭐ **IT IS ONE GLOBAL RULE NOW, NOT A CARD VALUE** (Dean, 02/09/2026). For
 * three editions the Barn printed it per suit (5/5/5/6/6, 7 on a flipped face)
 * and this function read the showing face. v31 deleted the printed number and
 * the whole rule with it; the same day's simulator run reversed that, and the
 * reinstated rule is deliberately a different shape: `rules.turn.handLimit`, one
 * number on the player aid, with the Barn still printing nothing. The function
 * keeps its name and its signature so every seam that used to ask it still asks
 * it, and takes `state` it no longer reads for the same reason - a limit that
 * varies by seat again would change only this body.
 *
 * ## Why it came back - the measurement, because this is the paragraph the next
 * person to think "a hand limit is just a clock, delete it" needs to find
 *
 * The limit was ALSO the only bound on `subsets` above, and nothing in the
 * design knew that. With it gone hands reached 34 cards, one 2-seat position
 * offered 43,879 legal moves (43,845 of them build payments), a re-measurement
 * found a worse one at 116,535, and a 2-seat game went from ~0.1s to 1-15
 * minutes - which reduced the entire watch-list suite to n=8 and made every
 * conclusion from that run an anecdote. Behind the engineering sits the design
 * failure: with no ceiling a card in hand has no diminishing return, so the free
 * bonus Draw 1 became strictly dominant and beat a neighbour visit 3:1. The hook
 * lost to arithmetic. See `RulesFile.turn.handLimit` for the rest.
 */
export function handLimitOf(data: GameData, _state: GameState, _seat: Seat): number | null {
  return data.rules.turn.handLimit;
}

/**
 * A seat's free hand space (reference DL-63): limit minus hand size, floored at
 * 0, and `Infinity` when the limit is off.
 *
 * THE GIFT FAMILY'S CAPACITY RULE, and the reason it is back: a gift never
 * forces an out-of-turn discard, so a neighbour already at their limit cannot be
 * given anything. Without it the Orchard gift cards (O6, O9, O16) stop being
 * gifts and become a way to make a rival discard, which is a different card and
 * a much nastier one. v31 read this as moot rather than repealed and said so at
 * this seam; with the limit back it is live again.
 */
export function freeHandSpace(data: GameData, state: GameState, seat: Seat): number {
  const limit = handLimitOf(data, state, seat);
  if (limit === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - player(state, seat).hand.length);
}

/** The barn as the per-suit tally every rule reads it as - identity is inert there. */
export function barnTally(
  data: GameData,
  state: GameState,
  seat: Seat,
): Partial<Record<Suit, number>> {
  const tally: Partial<Record<Suit, number>> = {};
  for (const id of player(state, seat).barn) {
    const suit = cardById(data, id).suit;
    tally[suit] = (tally[suit] ?? 0) + 1;
  }
  return tally;
}

/**
 * The tile's printed row. LAYOUT ONLY since the flat island (2026-08-09) - it
 * exists for the UI and for setup's bookend rule, and no rule reads it. If a
 * rule ever needs it again, that is the hierarchy coming back and it should be
 * priced as a new rule rather than a restoration.
 */
export function tileLevel(data: GameData, tileId: string): 1 | 2 | 3 {
  const tile = data.island.tiles.find((t) => t.id === tileId);
  if (!tile) throw new Error(`Unknown island tile ${tileId}`);
  return tile.level;
}

export function withoutFirst(items: readonly CardId[], drop: CardId): CardId[] {
  const i = items.indexOf(drop);
  return i < 0 ? [...items] : [...items.slice(0, i), ...items.slice(i + 1)];
}
