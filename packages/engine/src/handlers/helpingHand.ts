/**
 * A Helping Hand - one Power card per suit (W18/V18/O18/A18/D18), identical
 * text on all five copies:
 *
 *   "Each turn, you may take both bonus options: Draw 1 AND place a card on a
 *    Notice Board."
 *
 * REWRITTEN FOR v31 (Dean, 02/09/2026, plan section 3.1). It is now a BONUS-SLOT
 * MODIFIER and nothing else: roughly +1 card and one guaranteed door use a turn,
 * always live, with no trigger to remember.
 *
 * ⛔ WHAT IT USED TO BE, AND WHY THE SHAPE HAD TO GO. From 2026-08-10 it read
 * "When you VISIT a neighbour and use their Service, you may place a second card
 * on it to use it again", and it was the card that forced standing moves
 * (`handler.moves` / `applyMove`) into the handler API - the repeat was a real
 * optional MOVE between moves, offered by legalMoves while a gate held in
 * `turn.visit` stayed open. Every referent in that sentence is gone: there is no
 * Service, there is no wage to pay the host a second time, and `turn.visit` was
 * deleted with the gate. The denial angle it carried is gone with it - repeating
 * a visit drove the target toward its clog in half the turns - and that is worth
 * recording as a LOSS rather than a tidy-up, because it was the one card in the
 * game that let a player deliberately shut a door.
 *
 * ⭐ THE NEW SHAPE NEEDS NO HANDLER BODY AT ALL, and that is the whole of its
 * teach cost coming down. `bonusSlotsFor` (actions.ts) reads the printed rule
 * plus whatever card text grants, so "take both options" falls out of the
 * existing `bonusUsed` logic: two slots, and `bonusOpen(option)` already refuses
 * a second Draw 1 or a second placement, so the card gives ONE OF EACH and never
 * two of either. The wiring is `wireExtraBonusSlots`, called by registry.ts at
 * import time exactly as it calls `wireHookBus` - an indirection, not laziness,
 * because actions.ts may not import the registry (this file imports actions.ts,
 * and a value cycle between the two would be fragile).
 *
 * ⚠️ DUPLICATES DO NOT STACK, and the cap is written down rather than left to
 * emerge. There are exactly TWO bonus options, so a second copy could only ever
 * grant a slot with nothing legal to spend it on; capping at 1 says that in the
 * code instead of relying on `bonusOpen` to refuse it one layer down. If a third
 * bonus option is ever printed, this cap is the line to revisit.
 */

import { wireExtraBonusSlots } from '../actions.js';
import type { GameData } from '@gp/data';
import { builtCopies } from '../query.js';
import type { GameState, Seat } from '../state.js';
import type { CardHandler } from './types.js';

/** The card's shared name in cards.json - all five copies print it. */
const HELPING_HAND = 'Helping Hand';

/**
 * Extra bonus options this seat's built cards grant, on top of
 * `rules.turn.bonusSlotsPerTurn`.
 *
 * Exported for the registry to wire and for the tests to call directly; it is a
 * pure read of the tableau, so it is safe to call from an enumerator.
 */
export function extraBonusSlots(data: GameData, state: GameState, seat: Seat): number {
  return Math.min(1, builtCopies(data, state, seat, HELPING_HAND));
}

/** Install the lookup. Called once, from registry.ts, at import time. */
export function wireHelpingHand(): void {
  wireExtraBonusSlots(extraBonusSlots);
}

export const helpingHand: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Difficulty 5 to 2, and the drop is the v31 rewrite in one number. It was the hardest ' +
      'card in the game to implement - a standing move, a turn-scoped gate, a re-entry into ' +
      'the visit funnel and a second wage - and it is now a modifier on a counter. No prompt, ' +
      'no move, no hook: the whole behaviour is +1 bonus option, read by bonusSlotsFor. ' +
      'crossPlayer goes FALSE, which is worth reading rather than skipping past: the card no ' +
      'longer does anything to anybody else by itself. What it grants is a second bonus ' +
      'option, and whether that option is spent on a neighbour is the holder’s choice - so ' +
      'the card now points at the hook only as strongly as the player does. ' +
      '⚠️ IT IS THE ONE CARD IN THE GAME THAT PRINTS MORE ACTIONS, in a pass whose named ' +
      'risk 1 is action inflation. Five copies at 2 own-suit cards each is a cheap, always-on ' +
      '+1 card and +1 door use per turn; if actions-resolved-per-turn comes back high, this ' +
      'is a first suspect and the dial is the cost, not the text.',
  },
};
