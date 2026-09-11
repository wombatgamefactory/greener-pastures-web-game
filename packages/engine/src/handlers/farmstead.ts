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

/**
 * ⚠️ THE FILE KEEPS ITS NAME AND THE FIVE POWERS HAVE LEFT IT (10/09/2026).
 *
 * It was proposed that this file be renamed `notice-board-power.ts`, because
 * `rules.economy.farmsteadPower` was renamed `rules.economy.noticeBoardPower`
 * and the powers moved from the Farmstead's face to the Notice Board's (S12).
 * What is left here after that move is the FARMSTEAD CARD's handler and
 * nothing else, so `farmstead.ts` is the accurate name and a file called
 * `notice-board-power.ts` that did not contain the notice board's power would
 * be the misleading one.
 *
 * ⭐ THE POWERS ARE IN `workers.ts`, as `fireNoticeBoardPower`, beside
 * `performDoorAction`. That file is already "perform a suit's action, bought
 * by something", which is exactly what a Notice Board power is; it is also the
 * only home that keeps the module graph acyclic, since `actions.ts` calls the
 * dispatch from `doVisit` and may not import a handler.
 *
 * ⭐ AND THE FARMSTEAD IS INERT UNDER THE NOTICE-BOARD VISIT (S1, S4). Its
 * one job there is to hold six island receipt tokens in six printed slots, so
 * that every player's distance from ending the game is readable across the
 * table - a FACE with no rules text, no threshold, no activation and no
 * scorer. `barnCropScorer` at the foot of this file is the line that moves off
 * it, onto the Barn.
 */

import type { GameData, Suit } from '@gp/data';
import { farmsteadCoinPower, isNoticeBoardPower } from '@gp/data';

import { doorActionLegal } from '../actions.js';
import type { CardInPlay, Fx } from '../fx.js';
import { cropBuildings } from '../query.js';
import type { GameState, Seat } from '../state.js';
import { fireNoticeBoardPower } from '../workers.js';
import type { CardHandler } from './types.js';

/**
 * ⭐ WHICH GAMES FIRE A NOTICE BOARD POWER AT ALL, in one predicate, because
 * two very different routes reach the same five branches and confusing them is
 * how a knob rename becomes a rules change.
 *
 *  - `rules.economy.farmsteadCoinPower` is the SUPERSEDED coins arm of the
 *    morning of 10/09/2026 (K10-K12): the FARMSTEAD carries the power, its
 *    activation cost is one coin, it is your MAIN action and nothing is placed
 *    on it. The gate stays because a branch whose only producer is a knob at
 *    its shipped value is a control, not dead code - and because the coins
 *    measurement is what this design is read against.
 *  - `rules.turn.visitCurrency: 'noticeBoardPower'` is the arm of that evening
 *    (S1-S16): the NOTICE BOARD carries the power, a visitor buys it with one
 *    card from hand, and the power fires for the VISITOR while the card lands
 *    on the HOST. That route never reaches this file - `doVisit` calls
 *    `fireNoticeBoardPower` directly.
 *
 * ⚠️ THE TWO ARMS NOW SHARE ONE SET OF NUMBERS AND THREE OF THE FIVE
 * CHANGED MEANING UNDER THEM (S13, C88, C89). The coins arm's powers were
 * Draw 3 / build at a discount of 1 / GROW 2 / harvest every loaded building /
 * deliver twice; they are now Draw 4 / build with the crops waived / SOW 2 /
 * harvest one and bank a card / deliver-or-bank-two. That is deliberate and it
 * is named rather than silent: `rules.economy.farmsteadPower` was RENAMED
 * rather than copied, on the handoff's own reasoning that a knob whose name no
 * longer describes it is worse than a new one, and the coins arm's numbers
 * therefore have to be re-argued rather than inherited if it is ever re-run.
 */
function powersLive(data: GameData): boolean {
  return farmsteadCoinPower(data) || isNoticeBoardPower(data);
}

/**
 * ⭐ THE CROP SCORER, AS THE BARN PRINTS IT (S1, Dean 10/09/2026): *"Game
 * end: 1 VP for each `<CROP>` card you have built."*
 *
 * The line has moved twice in one day. v31 put it on the Farmstead; the coins
 * arm (K13) took it off, because a card cannot be three things and the
 * Farmstead had become a suit power, and it had nowhere to land - the five
 * Barns have had no handler at all since v31 blanked them, so that arm's
 * game-end total is the shipped total MINUS this term and `commons.test.ts`
 * asserts the difference by name. The notice-board rejig gives it a home: the
 * Barn's one job is to hold your harvested cards and print this, and the
 * Farmstead's one job is to hold six receipt tokens.
 *
 * ⚠️ SO THE ARM'S SCORES ARE COMPARABLE WITH THE SHIPPED GAME'S AND THE
 * COINS ARM'S ARE NOT, and that is the reason to wire it here rather than
 * leave the scorer on an inert Farmstead: the measurement pass reads winning
 * scores and their sources against the shipped commons, and a silently missing
 * VP term would be a passenger in every one of those readings.
 *
 * Both readings are unchanged and both fall out of `query.cropOf`: DECK CARDS
 * ONLY, so your three starters do not count; and EVERY deck card of the crop,
 * not just the buildings, so a Power card and an Endgame card of your own suit
 * each pay 1.
 */
export function barnCropScorer(crop: Suit) {
  return (data: GameData, state: GameState, seat: Seat): number =>
    isNoticeBoardPower(data) ? cropBuildings(data, state, seat, crop).length : 0;
}

/**
 * One suit's Farmstead. A factory rather than five hand-written handlers
 * because the five cards are the same card: any divergence between them would
 * be a mistake, and there is no way to write one here.
 *
 * ⚠️ IT KEYS OFF THE CROP PASSED IN, NOT OFF THE SEAT'S SUIT, even though
 * the two can never differ today - a Farmstead is a starter, so it is only
 * ever in front of the seat that plays its suit. The crop is what the card
 * PRINTS, and printing is the thing a handler implements.
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
        'look like. ' +
        '⚠️ THE FLAGS DESCRIBE THE SHIPPED CARD AND NEITHER ARM. Under ' +
        'rules.economy.farmsteadCoinPower (the superseded coins arm, 10/09/2026) this card ' +
        'is a coin-activated suit power that PROMPTS through four of its five faces and ' +
        'scores NOTHING at game end; under rules.turn.visitCurrency noticeBoardPower (the ' +
        'notice-board visit of the same evening, S1/S4) it is a token tray with no rules ' +
        'text at all, which is difficulty 0 and not 1. They are left as they are ' +
        'deliberately: the difficulty score is a teach-cost proxy for the game as shipped, ' +
        'and neither arm is shipped.',
    },
    /**
     * ⭐ THE COIN-ACTIVATED SUIT POWER (K10-K12), and it exists on the
     * shipped card only as this guard: with `farmsteadCoinPower` off the
     * Farmstead has no activation type at all (`cards.json` prints null), so
     * `growOptions` skips it, `activateOnly` refuses it and nothing in the
     * game can reach this callback.
     *
     * ⛔ AND IT STAYS THE COINS ARM'S ROUTE ONLY. Under the notice-board
     * visit the powers belong to the NOTICE BOARD and are bought by a visitor
     * with a card, so `doVisit` fires them directly; the Farmstead is inert
     * there (S1/S4) and this callback must not become a second way in.
     */
    activate(fx: Fx, self: CardInPlay): void {
      if (!farmsteadCoinPower(fx.data)) return;
      fireNoticeBoardPower(fx, self.seat, crop, {
        src: self.card,
        deliverLegal: doorActionLegal(fx.data, fx.state, self.seat, 'deliver'),
      });
    },

    /**
     * ⛔ AND THE SCORER IS OFF UNDER BOTH ARMS: *"Game end: 1 VP for each
     * `<CROP>` card you have built"* MOVES TO THE BARN.
     *
     * Under `farmsteadCoinPower` (K13, ruled 10/09/2026) it moved because a
     * card cannot be three things and the Farmstead had become a suit power,
     * and it had nowhere to land - so that arm's game-end total is the shipped
     * total minus exactly this term, which `commons.test.ts` asserts by name.
     * Under the notice-board visit (S1) it moves for the same reason and DOES
     * land: `barnCropScorer` above is wired onto all five Barns, so the term
     * survives and the arm's scores stay comparable with the shipped game's.
     */
    gameEnd(data: GameData, state: GameState, seat: Seat): number {
      if (powersLive(data)) return 0;
      return cropBuildings(data, state, seat, crop).length;
    },
  };
}
