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
import { farmsteadCoinPower } from '@gp/data';

import type { CardInPlay, Fx } from '../fx.js';
import { cropBuildings, player } from '../query.js';
import type { GameState, Seat } from '../state.js';
import type { CardHandler } from './types.js';

/**
 * ⭐ THE FIVE COIN-ACTIVATED SUIT POWERS (K11/K12, RULED BY DEAN 10/09/2026,
 * `docs/commons-coins-handoff-2026-09-10-v2.md` §2.3, and printed in column P of
 * `Isle-of-Farms-v35.xlsm`). Live ONLY under
 * `rules.economy.farmsteadCoinPower`, so the shipped Farmstead - one end-game
 * scorer and no seam anywhere - is untouched by every line below.
 *
 *   Orchard    "Draw 3."
 *   Dairy      "Build at a discount of 1, ignoring crop requirements."
 *   Apiary     "GROW 2 of your buildings, paying their activation costs as normal."
 *   Wheat      "Harvest every one of your buildings, however many cards are on them."
 *   Vegetable  "Deliver twice."
 *
 * ⭐ EACH IS WORTH ABOUT TWO PLAIN ACTIONS, because it costs the main action AND
 * a coin (K12). That is the calibration to argue with if the fires-by-suit
 * reading (a19) comes back lopsided - the four numbers are knobs
 * (`rules.economy.farmsteadPower.*`) and NONE of them is hard-coded here.
 *
 * ⚠️ THREE OF THE FIVE COLLIDE WITH CARDS ALREADY ON THE SHEET (§2.6 of the
 * handoff), which is a card-face question and not an engine one, but it is why
 * each power below says which card it is the same rule as: the Wheat power is
 * W13 The Bakery word for word, the Vegetable power is V15 The International
 * Port, and the Dairy power strictly dominates D4 The Milking Shed.
 */

/**
 * ⛔ THE APIARY POWER IS NOT A12 THE HONEY HUT, AND THAT DISTINCTION IS THE
 * WHOLE OF THE DIFFERENCE BETWEEN THE TWO CARDS.
 *
 * A12 and A5 The Meadow Hive GROW **without placing a card** - they push an
 * `activate` task, which fires a building's ability with no payment, no crop
 * matched and no stack advanced, and can therefore fire a building that is
 * already full. That is the Apiary suit's signature and its clog bypass.
 *
 * The Farmstead pays its activations AS NORMAL: `apiaryGrows` full `grow`
 * tasks, each answered out of `growOptions` and resolved through `doGrow`, so
 * each one costs a matching card out of the hand, puts that card on the stack,
 * and cannot target a full building at all. If this ever became an `activate`
 * task the Farmstead would silently be a better Honey Hut for one coin, which
 * is the failure §2.6 of the handoff names by name and the printed text is
 * worded to prevent.
 */
function growTasks(fx: Fx, self: CardInPlay, n: number): void {
  for (let i = 0; i < n; i++) fx.pushTask({ t: 'grow', pid: self.seat, src: self.card });
}

/**
 * ⭐ THE VEGETABLE POWER IS TWO FULL DELIVERIES (builder default D-C2, ruled by
 * Dean 10/09/2026): `vegetableDeliveries` separate `deliver` tasks, each PAID
 * for separately, TARGETED separately, taking ONE receipt each, and each free
 * to be an island claim or a balloon move independently of the other (DL-12).
 * The power is meant to be worth about two plain actions and this is what two
 * plain actions are.
 *
 * ⚠️ V14 The Vegetable Exchange CHOSE THE OTHER SHAPE AND THEY ARE DIFFERENT
 * RULES: it delivers ONCE and takes `receipts = 2` off one tile, which is one
 * payment for two receipts. V15 The International Port, which this power's
 * printed text duplicates, already pushes two deliver tasks exactly as this
 * does - so the collision to raise on the sheet is with V15, and the card NOT
 * to copy is V14.
 *
 * Two tasks rather than one task with a budget of 2, for V15's own reason: the
 * deliver task has no budget field and does not need one, because the queue is
 * the counter. The second task also enumerates AFTER the first resolves, so a
 * barn emptied by delivery one correctly offers nothing for delivery two.
 */
function deliverTasks(fx: Fx, self: CardInPlay, n: number): void {
  for (let i = 0; i < n; i++) fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
}

/**
 * ⭐ THE WHEAT POWER IS W13 THE BAKERY, WORD FOR WORD: *"Harvest every one of
 * your buildings, however many cards are on them."*
 *
 * This is W13's implementation - `harvestCascade` over `loadedBuildings`, both
 * in `handlers/wheat.ts` - restated rather than imported, and the reason is
 * structural: all five suit files import `farmsteadHandler` from THIS file, so
 * an import back into `wheat.ts` would close a module cycle whose wrong half
 * initialises first (`wheat.ts` calls `farmsteadHandler('wheat')` at module
 * scope). The rule is identical and must stay identical: snapshot the seat's
 * buildings holding one or more cards, harvest each of them once, no fullness
 * gate, and the Farmstead itself is never in the set because nothing is ever
 * placed on it (K10).
 *
 * ⚠️ W13 NEEDS A NEW TEXT OR A CUT (§2.6 of the handoff) and that is a Table B
 * row for the sheet, not an engine change: the collision is the sharper of the
 * three because Wheat's Tier 3 slot is thin already.
 */
function harvestEveryLoadedBuilding(fx: Fx, self: CardInPlay): void {
  const loaded = player(fx.state, self.seat)
    .tableau.filter((b) => b.stack.length >= 1)
    .map((b) => b.card);
  for (const card of loaded) fx.harvest(self.seat, card);
}

/**
 * The one power that is dispatched by CROP rather than written five times. The
 * `crop satisfies never` tail is the file's own exhaustiveness guard: a sixth
 * suit would fail to compile here rather than silently do nothing.
 */
function firePower(fx: Fx, self: CardInPlay, crop: Suit): void {
  const numbers = fx.data.rules.economy.farmsteadPower;
  switch (crop) {
    case 'orchard':
      // "Draw 3." Through the ordinary plain-draw path - a see-N/keep-N draw
      // task, one card from any deck in play per card seen, which is what every
      // card-granted draw in the game pushes. ⚠️ NOT the Orchard board's Draw 2:
      // that is a free bonus door and this is a paid main action, which is why
      // the retired Draw-3 door ruling (§5 of CLAUDE.md, dead twice over) has
      // nothing to say about it.
      fx.pushTask({
        t: 'draw',
        pid: self.seat,
        src: self.card,
        see: numbers.orchardDraw,
        keep: numbers.orchardDraw,
        revealed: [],
      });
      return;
    case 'dairy':
      // "Build at a discount of 1, ignoring crop requirements." ⭐ THIS IS D4
      // THE MILKING SHED'S IMPLEMENTATION, call shape and all (`buildWith` in
      // handlers/dairy.ts, which is one `build` task carrying `{ discount }`).
      // The crop waiver is NOT a second mod: `priceOf` in actions.ts ALREADY
      // sets the own-suit minimum to 0 whenever the discount is above 0, which
      // is the printed rule for every discount in the game, so the Farmstead's
      // second clause is describing what D4 already does rather than adding to
      // it. ⚠️ Which is also why this power strictly dominates D4 (§2.6): a
      // Table B row, not an engine problem.
      fx.pushTask({
        t: 'build',
        pid: self.seat,
        src: self.card,
        mods: { discount: numbers.dairyDiscount },
      });
      return;
    case 'apiary':
      growTasks(fx, self, numbers.apiaryGrows);
      return;
    case 'wheat':
      harvestEveryLoadedBuilding(fx, self);
      return;
    case 'vegetable':
      deliverTasks(fx, self, numbers.vegetableDeliveries);
      return;
    default:
      return crop satisfies never;
  }
}

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
        'look like. ' +
        '⚠️ THE FLAGS DESCRIBE THE SHIPPED CARD AND NOT THE COMMONS-WITH-COINS ARM ' +
        '(rules.economy.farmsteadCoinPower, 10/09/2026), under which this card is a ' +
        'coin-activated suit power that PROMPTS through four of its five faces and scores ' +
        'NOTHING at game end. They are left as they are deliberately: the difficulty score ' +
        'is a teach-cost proxy for the game as shipped, and the arm is not shipped. If it ' +
        'is ever ruled in, this whole block is rewritten at 3-4 and prompts goes true.',
    },
    /**
     * ⭐ THE COIN-ACTIVATED SUIT POWER (K10-K12), and it exists on the shipped
     * card only as this guard: with `farmsteadCoinPower` off the Farmstead has
     * no activation type at all (`cards.json` prints null), so `growOptions`
     * skips it, `activateOnly` refuses it and nothing in the game can reach
     * this callback. The guard is belt and braces against a future route
     * reaching a starter it should not.
     */
    activate(fx: Fx, self: CardInPlay): void {
      if (!farmsteadCoinPower(fx.data)) return;
      firePower(fx, self, crop);
    },

    /**
     * ⛔ AND THE SCORER IS OFF UNDER THE ARM (K13, ruled 10/09/2026): *"Game
     * end: 1 VP for each `<CROP>` card you have built"* MOVES TO THE BARN. It
     * is not deleted - the own-crop pull leaves with the Endgame cards' price
     * (K15) and with nothing else - but a card cannot be three things, so the
     * line comes off the Farmstead the moment the Farmstead is a suit power.
     *
     * ⚠️ AND UNDER THIS ARM IT SIMPLY DOES NOT FIRE, WHICH IS A REAL SCORING
     * DIFFERENCE AND NOT A NO-OP. The Barn has no handler at all - v31 blanked
     * all five on 02/09/2026 - so there is nothing for the scorer to move ONTO
     * in the engine, and the arm's game-end total is the shipped total MINUS
     * exactly this term. `commons.test.ts` asserts that difference by name, so
     * it is visible in a test rather than silent in a report. Giving the Barn a
     * handler is a card-face change (a Table B row on the v35 sheet), and doing
     * it here would put the scorer back before the arm has been measured.
     */
    gameEnd(data: GameData, state: GameState, seat: Seat): number {
      if (farmsteadCoinPower(data)) return 0;
      return cropBuildings(data, state, seat, crop).length;
    },
  };
}
