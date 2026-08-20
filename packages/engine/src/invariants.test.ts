/**
 * Ticket 30: the starter invariant.
 *
 * Every seat holds its three starters - Farmstead, Barn, Notice Board - for the
 * whole game. A great deal quietly rests on that: `noticeBoardOf` throws rather
 * than returning null, `handLimitOf` reads a missing Barn as NO hand limit, the
 * suit power lives on the Farmstead, and v14's Notice Board is the only visit
 * target in the game.
 *
 * It was false until ticket 30. D14's demolish took `emptyBuildings` unfiltered,
 * so a seat could remove its own starters, and `noticeBoardOf` then threw from
 * inside `legalMoves` - crashing the game for every seat, in 3 of 1510 reference
 * games and in 2-4 of every 12 for a Dairy-heavy one.
 *
 * ⚠️ THERE WERE TWO OFFENDERS UNTIL 19/08/2026 and there is now one. D11 The
 * Heritage House used to build ON TOP of a building, which is the other way a
 * card could take something out of a tableau; the retext to "Build. Sow all the
 * cards spent." deleted the build-on-top, the `cover` primitive and the whole
 * `covered` player zone with it. So there is no cover anywhere in the game, and
 * D14 is the only card left that can remove a building at all.
 *
 * The per-card half of the ruling is pinned in `handlers/dairy.test.ts`. The
 * structural guard - that D14 stays the ONE caller able to remove a building -
 * is `packages/sim/src/starter-invariant.test.ts`, which has to live over there
 * because reading files is what the engine may not do.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { player } from './query.js';
import { makeState } from './testkit.js';

// ⭐ THREE starters since change 6 (20/08/2026): the Service merged into the
// Notice Board, so there is no fourth.
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
