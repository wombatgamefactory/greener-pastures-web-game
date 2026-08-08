/**
 * The five SERVICE starters (2026-08-10), one per suit.
 *
 * They have no behaviour of their own, and that is the point: a Service is an
 * ordinary building with a threshold, and everything that makes it special
 * happens in the bonus-slot funnel rather than on the card.
 *
 *   a RIVAL places a card on it   -> actions.ts doVisit, payoff mode 'worker'
 *   the OWNER pays coins for it   -> actions.ts doWorkOwn
 *   what its action actually does -> workers.ts workWorker, from workers.json
 *
 * Registered anyway, because "every enabled card has a handler" is the test that
 * catches a card nobody has implemented, and a Service with no entry would read
 * as an oversight rather than as a deliberate blank.
 *
 * One entry, shared by all five: the difficulty metadata is identical because
 * the card is identical - only the action text printed on it differs, and that
 * comes from the data.
 */

import type { CardHandler } from './types.js';

export const suitService: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in the engine seams, not this entry. It is the second building a ' +
      'rival may place a card on (the first being the Notice Board), the only one that pays ' +
      'its OWNER rather than the visitor, and the only building whose owner activates it ' +
      'with coins instead of a card. crossPlayer is true because a visit lands a card on ' +
      'somebody else’s tableau and mints them coins; prompts is false because every ' +
      'choice it opens belongs to the ACTION it performs, not to the card.',
  },
};
