/**
 * THE FIVE FARMSTEADS (W2/V2/O2/A2/D2), v31 - one card printed five times, bar
 * the crop name:
 *
 *   "Game end: 1 VP for each <CROP> card you have built."
 *
 * ⛔ THIS REPLACES THE FIVE SUIT POWERS, and that is the largest single deletion
 * in the pass. Wheat's relaxed harvest, Vegetable's delivery head, Orchard's
 * draw modifier, Apiary's GROW rider and Dairy's build diversion were five
 * different mechanisms, four of which needed a seam inside a core funnel, and
 * they are all gone (the tombstones are in query.ts and actions.ts). What is
 * left is a scorer with no seam anywhere: a suit's identity now lives entirely
 * in its 18 deck cards, and the starter says only "be loyal to your crop".
 *
 * ⚠️ RISK 3 OF THE WHOLE PASS RUNS THROUGH THIS CARD (plan section 4). It pays
 * for own-suit density, and the 30 Power and Endgame cards cost 2 cards of their
 * own suit, so both push the same way - and the Innovation lens's standing
 * constraint is that the metric axis must not be the specialisation axis. The
 * own-crop build share was 82.6% before this change and can only go up. Neither
 * pull is a knob: undoing either is a card change.
 *
 * TWO READINGS, both settled by `query.cropOf` rather than by a carve-out here:
 *
 *  1. **Deck cards only.** Your three starters do not count. A starter prints
 *     the generic starting-building icon and belongs to no crop, so it counts
 *     neither for its crop nor against it - the same rule W19, A19 and D19 read.
 *     Without it every seat would collect a flat 3 for turning up.
 *  2. **Every deck card of the crop, not just the buildings.** A Power card and
 *     an Endgame card print their crop icon like anything else, so a Wheat seat
 *     holding W16 and W19 is 2 VP up. That is deliberate and it is what makes
 *     the own-suit Power price (2 cards of that card's own suit) point the same
 *     way twice; it is also the half of the card most likely to be re-read if
 *     risk 3 bites.
 *
 * ON TOP OF each card's printed VP, per the plan: this is a second line, not a
 * replacement for the tableau's printed points.
 */

import type { GameData, Suit } from '@gp/data';

import { cropBuildings } from '../query.js';
import type { GameState, Seat } from '../state.js';
import type { CardHandler } from './types.js';

/**
 * One suit's Farmstead. A factory rather than five hand-written handlers because
 * the five cards are the same card: any divergence between them would be a
 * mistake, and there is no way to write one here.
 *
 * ⚠️ IT KEYS OFF THE CROP PASSED IN, NOT OFF THE SEAT'S SUIT, even though the
 * two can never differ today - a Farmstead is a starter, so it is only ever in
 * front of the seat that plays its suit. The crop is what the card PRINTS, and
 * printing is the thing a handler implements.
 */
export function farmsteadHandler(crop: Suit): CardHandler {
  return {
    difficulty: {
      score: 1,
      verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
      asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
      notes:
        'Difficulty 3-4 down to 1, and the number is the point of the change: four of the ' +
        'five old Farmsteads needed a seam inside a core action funnel (the draw numbers, ' +
        'the delivery head, the GROW branch, the build payment) and this one is a count of ' +
        'a tableau at scoring time. It is the cheapest card in the game to teach and the ' +
        'cheapest to implement. ' +
        '⚠️ It does NOT register a trigger in the data: cards.json gives all five ' +
        'Farmsteads `abilityTrigger: []`, because starters have never carried a trigger ' +
        'array, so nothing may key a handler off that field. The registry keys off the ' +
        'card id, which is why this works at all - the trap is deliberate and was flagged ' +
        'by the sheet pass. ' +
        'endgame is true and every other flag false: no prompt, no hook, no move, and ' +
        'nothing cross-table, which is exactly what a starter with one printed line should ' +
        'look like.',
    },
    gameEnd(data: GameData, state: GameState, seat: Seat): number {
      return cropBuildings(data, state, seat, crop).length;
    },
  };
}
