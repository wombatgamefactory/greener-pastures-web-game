/**
 * Ticket 30: the starter invariant.
 *
 * Every seat holds its three starters - Farmstead, Barn, Notice Board - for the
 * whole game. A great deal quietly rests on that: `noticeBoardOf` throws rather
 * than returning null, `handLimitOf` reads a missing Barn as NO hand limit, the
 * suit power and the free-flip milestone live on the Farmstead, and v14's Notice
 * Board is the only visit target in the game.
 *
 * It was false until ticket 30. D11's cover and D14's demolish took
 * `emptyBuildings` unfiltered, so a seat could remove its own starters, and
 * `noticeBoardOf` then threw from inside `legalMoves` - crashing the game for
 * every seat, in 3 of 1510 reference games and in 2-4 of every 12 for a
 * Dairy-heavy one.
 *
 * The per-card halves of the ruling are pinned in `handlers/dairy.test.ts`. The
 * structural guard - that D11 and D14 stay the only two callers able to remove a
 * building at all - is `packages/sim/src/starter-invariant.test.ts`, which has to
 * live over there because reading files is what the engine may not do.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { player } from './query.js';
import { makeState } from './testkit.js';

describe('every seat keeps three starters', () => {
  it('deals exactly one Farmstead, Barn and Notice Board per seat', () => {
    const state = makeState(data, ['dairy', 'wheat', 'orchard']);
    for (const seat of [0, 1, 2]) {
      const slots = player(state, seat)
        .tableau.map((b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot)
        .filter((slot) => slot !== undefined)
        .sort();
      expect(slots, `seat ${seat}`).toEqual(['barn', 'farmstead', 'noticeboard']);
    }
  });
});
