/**
 * Wheat handlers - all 21 cards, REBUILT (docs/wheat-suit-rebuild-v5.md). Card
 * texts are quoted from cards.json (the sheet is the single source of truth for
 * wording).
 *
 * Suit identity: Harvest, and the rebuild's whole thesis is that the identity was
 * never in doubt - the INTERVAL was. Every Tier 1 FIELD reads on two lines:
 *
 *     GROW:    Draw 1.
 *     HARVEST: [the payoff].
 *
 * SIMPLIFIED 2026-08-19 (v30, plan group D). The seed-corn line - "Sow 1 deck
 * card onto this FIELD" - used to sit on the back of five FIELDs and is now
 * printed on ONE, W5 Rye Field. W6, W7 and W8 lost it in the same pass that took
 * W7's GROW-time deck sow and W8's GROW-time barn deposit. The shape it bought
 * (with a seed already down, one GROW refills a threshold-2 FIELD, so the loop is
 * GROW, harvest, GROW, harvest) survives on W5 alone, and everywhere else the
 * FIELD starts each cycle empty. That is a real slowdown, taken deliberately for
 * teach cost: five cards printing a second sentence about deck tops was the
 * densest paragraph in the suit. `reseed` stays written once, for W5 and W4.
 *
 * The other structural thing to know here:
 *
 *   1. **Tier 3 is GROW, like everything else.** RULED by Dean 19/08/2026: *"The
 *      concept of an ACTION was never requested. They are all GROW."* W13/W14/W15
 *      used to print no threshold and offer a standing MOVE that consumed the main
 *      action (`actionMoves` / `moves` / `applyMove`, with `applyMove` spending
 *      `turn.actionSpent` itself). All of that is gone. The sheet gives them a
 *      threshold (W13 1, W14 2, W15 1) and `activationType: "wild"`, so they are
 *      ordinary owner-activated buildings: pay any one card into the stack, the
 *      ability fires, and the GROW action - not the card - spends the turn. The
 *      old note here argued the ACTION gate on measurement (a GROW-gated Tier 3
 *      fired 0.63 times per card built, an action-gated one as often as its owner
 *      chose). That measurement is not disputed; it was simply not what was asked
 *      for, and the rate it bought cost a whole second way to spend a turn.
 *
 * REBALANCED 2026-08-12 (docs/wheat-rebalance-v1.md). The rebuild below worked
 * too well: Wheat came in FIRST at 50.0% against an even share of 36.4%, on the
 * most cards into the barn in the game (30.5), and island receipts are 69% of a
 * winning score. Four things in this file and actions.ts came down together, all
 * of them free-card faucets: W1's Draw 2 to Draw 1, the reseed's free choice of
 * FIELD to the one that just harvested, W2's upgraded "Harvest is 2 buildings"
 * to a deeper relaxed gate, and W16 onto the once-per-turn guard. The notes on
 * each say what the number was and what it is. ⚠️ Those notes made a good case
 * for the numbers they are losing, and they were RIGHT - for a suit that had
 * been rebuilt five times for being too slow. The suit has since crossed the
 * middle; that is the whole of the disagreement.
 *
 * The Farmstead's seam is IN THIS FILE now. `wheatRelaxedMin` and its two
 * constants are deleted from actions.ts: the sheet swapped W2 and W3 on
 * 19/08/2026, so the relaxed harvest is W3's visitor door (workers.json,
 * `relaxedMin: 2`) and W2 is a harvest rider with a real handler body.
 * `harvestAgainPower` is stubbed to `false`, which makes game.ts's entire
 * `turn.again` machinery unreachable; see its docblock for why that is not
 * deleted in the same change as the measurement. W4's auto-harvest and W8's
 * surcharge are GONE from the design; `harvestSurchargeOf` and the cascade's
 * surcharge branch stay in place for the other suits, and nothing in Wheat
 * prints either any more.
 *
 * RULING (2026-08-09, decided): a suit power modifies the ACTION, never card text
 * that happens to use the same word. W8, W11, W12 and W13 spell their own gates
 * out in words. ⚠️ SINCE THE W2/W3 SWAP THE RULING IS STRUCTURALLY TRIVIAL HERE,
 * and that is worth saying rather than leaving the paragraph to look load-bearing:
 * Wheat has no suit-power relaxation left to leak, because the relaxation is an
 * action's property now and only the `harvestable` task filter's `relaxedMin`
 * rider carries it. The ruling itself is not refuted, it simply has no Wheat
 * instance any more; the Orchard draw modifier is where it still bites.
 *
 * FIELD is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42): W4-W8, the only cards in the catalogue named Field.
 */

import type { GameData, Suit } from '@gp/data';

import type { Fx } from '../fx.js';
import { cardById, cropOf, drawableSuits, player } from '../query.js';
import { markFired } from '../runtime.js';
import type { BuildingState, CardId, GameState, Seat } from '../state.js';
import { farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

const FIELD_NAME = /\bField\b/;

/** FIELD sub-type membership, by whole-word title keyword (reference DL-42). */
export function isFieldCard(data: GameData, id: CardId): boolean {
  return FIELD_NAME.test(cardById(data, id).name);
}

function ownFields(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isFieldCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/**
 * The shared FIELD line: **"Sow 1 deck card onto this FIELD"** - sow the top card
 * of any deck onto THE FIELD THAT JUST HARVESTED.
 *
 * ⚠️ NO LONGER SHARED BY FIVE CARDS (v30, 19/08/2026). The sheet prints it on W5
 * alone: W6, W7 and W8 dropped it in the group D simplification pass. It stays a
 * function rather than being inlined into W5 because W4 still calls it - see the
 * ⚠️ on W4, where the handler and the printed text disagree and a ruling is owed.
 *
 * ⚠️ NARROWED BY THE WHEAT REBALANCE (2026-08-12). It used to target every FIELD
 * the seat owned, which let a wide Wheat farm aim each seed at whichever FIELD
 * was closest to full and turn one harvest into the next one. `src` is the
 * harvesting building, so the seed now lands back where it came from and
 * nowhere else. The card's own loop is untouched - the FIELD it just emptied
 * always has room, so the seed never fails to land - but the seat can no longer
 * pick, and the number of FIELDs stops multiplying the line.
 *
 * A task rather than an inline call because a choice remains: which deck. It
 * skips itself silently if the target somehow has no room, which is normal
 * rather than an error - the drain loop drops a task with no legal answer.
 *
 * Two things fall out of the narrowing, both good. The old caveat about a FIELD
 * BUILT after the push (W7's "Build ... Sow 1 FIELD") is moot, because the
 * target is fixed at push time and is never a new building - and moot twice
 * over now that W7 prints no seed line at all. And the task drops from a
 * two-part choice to a one-part one: TEACH COST GOES DOWN.
 */
function reseed(fx: Fx, seat: Seat, src: CardId): void {
  fx.pushTask({
    t: 'sowFromDeck',
    pid: seat,
    src,
    remaining: 1,
    targets: [{ seat, card: src }],
  });
}

/** Is this hook event THIS building being harvested by its own owner? */
function harvestedSelf(
  event: { seat: Seat; building: CardId },
  self: { seat: Seat; card: CardId },
): boolean {
  return event.seat === self.seat && event.building === self.card;
}

/** The seat's buildings holding 1 or more cards - W12's and W13's printed gate. */
function loadedBuildings(state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => b.stack.length >= 1);
}

/**
 * The cascade shape shared by W12/W13: snapshot the qualifying set, harvest each
 * one once.
 *
 * ⛔ ITS SURCHARGE BRANCH IS GONE (v31). It read a printed £1 harvest toll off
 * a data trigger (`harvestSurchargeOf`, deleted with the currency) and pushed a
 * `surcharge` task per tolled building. Two things are worth keeping from it.
 * The toll's PATTERN was right and should be reused if one ever returns priced
 * in cards: keyed on a data trigger so no funnel names a card, checked in the
 * enumerator so an unaffordable target is never offered, charged in the funnel
 * so the two cannot disagree. And the branch was already DEAD before v31 - no
 * card in the catalogue had carried the trigger since the Wheat rebuild, and no
 * handler ever registered a `surcharge` task resolver, so a tolled building
 * would have thrown at the head of the queue rather than charging anybody.
 */
function harvestCascade(fx: Fx, seat: Seat, buildings: CardId[]): void {
  for (const card of buildings) fx.harvest(seat, card);
}

/**
 * W1 Barn (starter) - prints NOTHING (v31).
 *
 * ⛔ BOTH OF ITS LINES WENT IN ONE EDIT, and they went for different reasons.
 * The printed HAND SIZE went because the hand limit was deleted outright, and
 * that half was reversed on 02/09/2026 - see the note below. The
 * BUILD RIDER - "When you build a FIELD, Draw 1", printed on all five Barns with
 * one word changed - was deleted outright rather than moved, and the Dairy
 * rebalance had already measured why: a line the sheet treats as shared pays out
 * in proportion to how much a suit BUILDS, so at 12.02 builds a seat it paid
 * Dairy 2.4x what it paid anybody else. A shared line on an unshared metric is a
 * hidden per-suit faucet.
 *
 * The Barn is now a zone with a card in front of it: somewhere to keep cards
 * ready for delivery, and no text at all.
 *
 * ⭐ THE HAND LIMIT CAME BACK ON 02/09/2026 AND THIS CARD DID NOT.
 * The reinstated limit is a flat 12 for everybody, held in
 * `rules.turn.handLimit` and read off the player aid; the Barn stays blank.
 * That is the whole difference between the old rule and the new one - a rule
 * that applies to every seat is not a card value - so nothing here should be
 * un-deleted. See `RulesFile.turn.handLimit` for what the deletion measured.
 */
export const wheatBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour, and no printed text to have behaviour about (cards.json carries an ' +
      'empty abilityText on all five Barns). Registered anyway, because "every enabled card ' +
      'has a handler" is the test that catches a card nobody has implemented, and a Barn ' +
      'with no entry would read as an oversight rather than as a deliberate blank.',
  },
};

/**
 * W2 Farmstead (starter) - "Game end: 1 VP for each Wheat card you have built."
 *
 * ⛔ THE RELAXED HARVEST AND THE BARN DEPOSIT ARE BOTH GONE (v31). This card
 * moved twice in three weeks and it is worth the two sentences. It WAS the
 * relaxed-harvest gate - "harvest a building with 2+ cards even if it is not
 * full" - held in an engine seam (`wheatRelaxedMin`, actions.ts); on 19/08/2026
 * the sheet swapped W2 and W3, so the relaxation became the Wheat DOOR's action
 * and this card became a harvest rider that put a card into the barn. v31
 * deletes both halves: the doors are plain, and all five Farmsteads print one
 * end-game scorer.
 *
 * The scorer is shared - see farmstead.ts for the two readings and for risk 3.
 */
export const wheatFarmstead: CardHandler = farmsteadHandler('wheat');

/**
 * W3 Notice Board (starter) - "VISITOR: place 1 card here, then Harvest one of
 * your full buildings." Threshold 2, wild activation.
 */
export const wheatNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - the fee landing on the board, the door action ' +
      'that follows and the clog at threshold 2 - is engine-level (doVisit in actions.ts, ' +
      'performDoorAction in workers.ts, the action itself in workers.json). ' +
      '⛔ THE COIN PAYOFF AND THE RELAXED HARVEST ARE BOTH GONE (v31). The board used to ' +
      'offer a visitor a choice of £1 or the door; there is one payoff now, which is why ' +
      'the printed text lost its OR. And the door is the PLAIN Harvest - full buildings ' +
      'only - where it carried "2 or more cards, even if not full" from 19/08/2026: the ' +
      'bonus slot became the enhancement, so stacking a rider on top of a whole free core ' +
      'action was pricing a sweetener into a deal that no longer needed one. ' +
      '⚠️ Its threshold of 2 is the only economy number left in the game and the one lever ' +
      'ever measured to move the suit balance; see rules.json.',
  },
};

/**
 * W4 Wheat Field - "Draw 1. / HARVEST: Put 1 card from your hand into your barn."
 */
export const wheatField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "The suit's freight payoff: a hand card becomes barn stock, which is the one thing " +
      'the island reads. READING: the hand-to-barn is printed "Put", not "you may", so the ' +
      'task is MANDATORY - it auto-skips on an empty hand, which is the only way it can be ' +
      'declined. Owner-scoped and self-scoped: a cross-player harvest (nothing in Wheat ' +
      "does one now) would still pay this building's owner. " +
      '⚠️ THE RESEED IS GONE (Dean ruled the sheet correct, 19/08/2026). The printed text ' +
      'stops at "Draw 1. / HARVEST: Put 1 card from your hand into your barn." The line came ' +
      'off W4 in the same sheet generation that took it off W6/W7/W8, and W5 keeps it, so ' +
      'the intention was deliberate. It is NOT housekeeping: the reseed is what kept every ' +
      'FIELD sitting at 1 or more card, which is what made the old relaxed harvest gate ' +
      'legal essentially always. That gate has left the suit in the same pass (see W2), so ' +
      "the two changes compound and Wheat's harvest is now genuinely gated on filling a " +
      'building. Watch harvest tempo in the next arm before touching anything else here.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (!harvestedSelf(event, self)) return;
      fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: 1 });
      // ⛔ THE RESEED IS GONE (19/08/2026). W4 printed "Sow 1 deck card onto
      // this FIELD" until the sheet dropped the line, and Dean ruled the sheet
      // correct. It is not housekeeping: the reseed is what kept every FIELD at
      // 1 or more card, which is what made the old relaxed harvest gate legal
      // essentially always. With the gate gone from the suit as well (see W2),
      // Wheat's harvest is now genuinely gated on filling a building.
    },
  },
};

/**
 * W5 Rye Field - "Draw 1. / HARVEST: Draw 2. Sow 1 deck card onto this FIELD."
 * The last FIELD in the suit that prints the seed line (v30, 19/08/2026).
 */
export const ryeField: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "The suit's card payoff, and the plainest FIELD in the set. Card-ability draws, so " +
      'the Orchard Farmstead modifier does not apply (DL-47).',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (!harvestedSelf(event, self)) return;
      drawN(fx, self.seat, self.card, 2);
      reseed(fx, self.seat, self.card);
    },
  },
};

/**
 * W6 Barley Field - "Draw 1. / HARVEST: Sow 1 card onto each of your FIELDs."
 */
export const barleyField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "The suit's placement payoff, and its ONLY colour-control card: the sow comes from " +
      'your HAND, so you choose the crop, where every other Wheat sow comes blind off a ' +
      'deck. That is the printed decision between volume and colour, and it matters ' +
      "because the barn's colours are what the island's crates read. One task per FIELD " +
      'you own at the moment of harvest - W6 itself included, since it has just emptied - ' +
      'each mandatory as printed and each auto-skipping on an empty hand or a full FIELD. ' +
      'SIMPLIFIED 2026-08-19 (v30, group D): the trailing "Sow 1 deck card onto this FIELD" ' +
      'is deleted, so the harvest is now one clause and one kind of placement. Note the ' +
      'wording lost "from your hand" as well - that is a SOW-is-suit-free tidy in the ' +
      'sheet, not a change of source: SOW has never required a match, and the source is ' +
      'still the hand, which is the whole reason this card is the colour-control one. ' +
      'Difficulty 3 to 2: it is now exactly W9 Mill House with a hand source instead of a ' +
      'deck source, and W9 has always scored 2.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (!harvestedSelf(event, self)) return;
      for (const field of ownFields(fx.data, fx.state, self.seat)) {
        fx.pushTask({
          t: 'sow',
          pid: self.seat,
          src: self.card,
          remaining: 1,
          targets: [{ seat: self.seat, card: field.card }],
        });
      }
    },
  },
};

/**
 * W7 Golden Field - "Draw 1. / HARVEST: Build, at a discount of 2."
 */
export const goldenField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: true },
    notes:
      "The suit's tableau payoff. The harvest build is a real Build under the shared " +
      "task's discount mod (the Dairy path), not a free one, and it auto-skips when " +
      'nothing is buildable. SIMPLIFIED AND STRENGTHENED 2026-08-19 (v30, group D): the ' +
      "GROW-time deck sow is deleted, the harvest's seed line with it, and the build " +
      'discount goes 1 to 2. That discount is THE ONE DELIBERATE POWER INCREASE IN THE ' +
      'WHEAT BLOCK, and it is the compensation - the card lost two free cards a cycle ' +
      '(the GROW deck card and the seed) and got a cheaper Build instead, which is the ' +
      'trade of raw cards for tableau the suit is meant to be making. ⚠️ WATCH THE ' +
      'THRESHOLD. It is still 3 on the sheet, and the old note called that load-bearing ' +
      'for a reason that has now evaporated: the GROW used to add TWO cards (your payment ' +
      'plus a deck card), so with a seed down one activation filled it. It now adds one, ' +
      'and no seed arrives, so the FIELD wants three GROWs from empty where every other ' +
      'Tier 1 FIELD wants two. That is the slowest payoff interval in the suit sitting on ' +
      'the card whose payoff is the most conditional. If Wheat measures slow after v30, ' +
      'W7 threshold 3 to 2 is the first dial to reach for, and it is a sheet edit.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (!harvestedSelf(event, self)) return;
      fx.pushTask({ t: 'build', pid: self.seat, src: self.card, mods: { discount: 2 } });
    },
  },
};

/**
 * W8 Heritage Field - "Draw 1 / HARVEST: Harvest another of your buildings, even
 * if not full."
 */
export const heritageField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: true },
    notes:
      "The suit's double-skip: one harvest buys a second. Its £1 surcharge is GONE from " +
      'the design, so the `harvestSurcharge` trigger no longer appears on any Wheat card ' +
      'and this handler no longer owns a surcharge task. SIMPLIFIED 2026-08-19 (v30, group ' +
      'D): the GROW-time barn deposit and the harvest seed line are both deleted, so the ' +
      'card is now one line on each face. ⛔ THE READING INVERTS WITH THEM. It used to say ' +
      'plain "another of your buildings", which was the STRICT full gate precisely because ' +
      'W11, W12 and W13 spelled their exception out in words and this card did not. It now ' +
      'prints "even if not full", so it joins them: the gate is `chooseBuilding` filter ' +
      "'loaded', 1 or more cards, which is the same filter W11 uses for \"however many " +
      'cards are on it". ⚠️ It is NOT the Wheat Farmstead\'s relaxed gate, and since 19/08/2026 W2 has no such gate: ' +
      'the 2+ relaxation moved to W3 the Notice Board, where it belongs to the visitor door ' +
      'rather than to the seat, so there is nothing left here to confuse it with. The decided ' +
      'suit-power ruling (2026-08-09) is that a suit power modifies the action and never ' +
      'card text - so this card carries its own threshold of 1, on both faces of W2 and ' +
      'for a seat that has flipped neither.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (!harvestedSelf(event, self)) return;
      fx.pushTask({
        t: 'chooseBuilding',
        pid: self.seat,
        src: self.card,
        filter: 'loaded',
        exclude: self.card,
        then: 'harvest',
      });
    },
  },
};

/** W9 Mill House - "Sow the top card of any deck onto each of your FIELDs." */
export const millHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The supply card the scaling layer needs: one deck-top per FIELD, so a wide Wheat ' +
      'farm advances every FIELD one step for one action. One task per FIELD rather than ' +
      'one task with a count, because the deck is chosen per card and a full FIELD has to ' +
      'drop out on its own.',
  },
  activate(fx, self) {
    for (const field of ownFields(fx.data, fx.state, self.seat)) {
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: field.card }],
      });
    }
  },
};

/** W10 The Furrow - "Put your entire hand into your barn." */
export const furrow: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'No task: there is no choice, which is exactly why the card is cheap to build. It ' +
      'scales on your hand size, on how much you have drawn and on how badly you need ' +
      'freight, and it charges a whole turn of options to do it. Watch-list: an empty hand ' +
      'cannot visit, so a Furrow turn is a turn the hook does not get - assertion 6 in the ' +
      "rebuild doc is a Wheat seat's visits per turn against the table.",
  },
  activate(fx, self) {
    // Copy first: handToBarn mutates the hand it is iterating.
    for (const card of [...player(fx.state, self.seat).hand]) {
      fx.handToBarn(self.seat, card);
    }
  },
};

/**
 * W11 The Bakehouse - "Harvest one of your buildings, however many cards are on
 * it, then Deliver."
 */
export const bakehouse: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "The suit's whole pipeline in one action, and the one card in Wheat that SHIPS " +
      'freight - the suit manufactures barn stock and had nothing anywhere in it that ' +
      "moved any. RULED by Dean 2026-08-09: the Deliver stands, crossing into Vegetable's " +
      'verb, on the O15 precedent. "However many cards are on it" is the printed exception ' +
      "to the full gate, encoded as the chooseBuilding 'loaded' filter, and it is a CARD " +
      'effect, so the upgraded Farmstead never doubles it. The Deliver is the full action ' +
      '(island claims AND balloon moves, DL-12) and auto-skips when nothing is payable. ' +
      'The harvest resolves first because tasks answer in queue order, so its cards are in ' +
      'the barn before the delivery enumerates; on the W15/A5 "then" precedent the ' +
      'delivery still runs if the harvest had no target.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'loaded',
      then: 'harvest',
    });
    // ⛔ THE DELIVER IS GONE (ruling F, closed by Dean 2026-08-12, applied
    // 19/08/2026). "Harvest one of your buildings, then Deliver" gave Wheat the
    // Vegetable suit's core verb for free; Dean ruled the Deliver belongs to
    // Vegetable, the sheet dropped it the same day, and the engine kept pushing
    // the task for a week. V7 The Export Depot keeps the pairing.
  },
};

/** W12 Crop Rotation - "Harvest every FIELD with 1 or more cards on it." */
export const cropRotation: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The payoff card the FIELDs are the supply for: every FIELD fires its harvest line ' +
      'at once, so the more FIELDs you own the cheaper each payoff gets. "1 or more" is ' +
      'printed rather than implied, and it EARNS ITS WORDS AGAIN AS OF v30 (19/08/2026): ' +
      'the old note said the reseed made it always true, so it was only a teach for the ' +
      'partial harvest. With the seed line now printed on W5 alone, four of the five ' +
      'FIELDs sit empty after a harvest and the clause decides which of them this card ' +
      'reaches. It prompts through the FIELDs it harvests (their ' +
      'harvest lines push the tasks), not on its own account. W12 is not a FIELD, so it ' +
      'never harvests itself. Watch-list: this may be above the Tier 2 budget, and the ' +
      'dial is a cap on the number of FIELDs it reaches.',
  },
  activate(fx, self) {
    const ready = ownFields(fx.data, fx.state, self.seat)
      .filter((b) => b.stack.length >= 1)
      .map((b) => b.card);
    harvestCascade(fx, self.seat, ready);
  },
};

/**
 * W13 The Bakery - "Harvest every one of your buildings, however many cards are
 * on them." Threshold 1, activation wild.
 */
export const bakery: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      '⛔ NO LONGER AN ACTION CARD (19/08/2026). The ACTION concept was RETIRED from the ' +
      'game on Dean\'s ruling - "The concept of an ACTION was never requested. They are all ' +
      'GROW." - and W13 was the first card ever written in that shape, so it is the one ' +
      'whose note has to record the seam that is gone: `actionMoves` / `moves` / ' +
      '`applyMove`, with `applyMove` setting `turn.actionSpent` itself and `moves` gating ' +
      'on it being unspent. All of it is deleted. The card is now an ordinary GROW ' +
      'building at threshold 1 with a wild activation, so it costs a card and the main ' +
      'action like everything else, and one card fills it - so the loop is grow, cascade, ' +
      'and the cascade takes the payment straight back off it. ' +
      '"Every one of your buildings" means every one: the Notice Board and the Service ' +
      'unclog too, which is the largest part of what the card is for, and W13 ITSELF is in ' +
      'the set (the grow payment is on its stack before the ability fires, so the card ' +
      'harvests its own fee into the barn - correct, and worth knowing before it reads as ' +
      'a bug). It prompts through what it harvests. Order cannot matter - per-harvest ' +
      'listeners see each harvest separately. It no longer needs a "have I anything to ' +
      'harvest" gate: an empty farm makes the cascade a no-op, and a GROW that does ' +
      'nothing is a choice the owner made rather than a move the engine offered.',
  },
  activate(fx, self) {
    harvestCascade(
      fx,
      self.seat,
      loadedBuildings(fx.state, self.seat).map((b) => b.card),
    );
  },
};

/**
 * W14 The Pizzeria - "Every player, including you, may Draw 1. For each card
 * drawn, gain £1." Threshold 2, activation wild.
 */
export const pizzeria: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'The only card in the suit that PROMPTS A RIVAL, and one of two that print a £ - both ' +
      "of them need somebody else at the table, which is the rebuild's coin rule in " +
      'miniature. One offer task per seat, each theirs to answer, each with a real decline: ' +
      'a free card against handing the baker £1. Priced at £1 rather than £2 because the ' +
      "binding constraint is the RIVAL's willingness - a card that needs consent does " +
      'nothing if consent is withheld. The £1 mints on acceptance rather than on the card ' +
      "actually arriving (the W15/A5 'then' precedent); the gate needs a live deck, so the " +
      'gap is a deck emptying mid-effect. Card-ability draws: no Orchard modifier (DL-47). ' +
      '⚠️ THE BOTS ALWAYS ACCEPT, by construction and not by accident - the probe pricer ' +
      "models what a seat GAINS and never rival harm (see outcome.ts's one rule), so a " +
      "sim's acceptance rate is an upper bound and the decline is a table question. " +
      '⛔ THE COIN IS A CARD (v31, plan section 3.3): "For each card drawn, gain £1" reads ' +
      '"Then Draw 1 for each card ANOTHER player drew". The conversion is not a straight ' +
      "swap and the sheet was careful about it. Under the old text the OWNER's own " +
      'acceptance paid the owner £1, which was a floor of one card and one coin before ' +
      'anybody else answered; under the new one it pays nothing, because a card that paid ' +
      'itself would make the card a naked Draw 2 for its owner and the rivals decorative. ' +
      'So the owner is still OFFERED the draw - that clause is untouched - but the payout ' +
      'is strictly cross-table. ' +
      '⚠️ THE RATE WENT UP IN REAL TERMS. A coin was never worth a card in this game (seats ' +
      'ended on about £1), so paying a card per rival acceptance is a materially bigger ' +
      'faucet than paying a coin was, on a suit whose rebalance thesis was that Wheat gets ' +
      'too many free cards. If Wheat runs hot after v31, this is a first suspect and the ' +
      'dial is the payout rate, never the offer - the offer is what the sheet prints. ' +
      'Task order is the owner first, then the rivals in seat order, which matters only for ' +
      'who sees a deck run dry.',
  },
  activate(fx, self) {
    // The owner's own offer is pushed FIRST and the rivals follow in seat order.
    // The rotation is deliberate rather than decorative: the offers resolve in
    // queue order, and the only thing order can decide is who gets the last card
    // of a deck that runs dry mid-effect, which should be the card's owner.
    for (let i = 0; i < fx.state.players.length; i++) {
      fx.pushTask({
        t: 'card',
        pid: ((self.seat + i) % fx.state.players.length) as Seat,
        src: self.card,
        kind: 'offerDraw',
        riders: { owner: self.seat },
      });
    }
  },
  tasks: {
    offerDraw: {
      answers(data, state) {
        if (drawableSuits(data, state).length === 0) return [];
        return [{ kind: 'card', payload: { take: true } }, { kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        drawN(fx, task.pid, task.src, 1);
        const owner = task.riders.owner as Seat;
        // "Then Draw 1 for each card ANOTHER player drew" - so the owner's own
        // acceptance pays nothing, and each rival's pays one card.
        //
        // Paid HERE, one at a time, rather than counted up and paid once at the
        // end. The two are identical in effect - a see-N/keep-N draw picks a
        // deck per card, so N draws of 1 offer exactly the choices one draw of N
        // does - and doing it per acceptance needs no counter riding on a task
        // and no final task to read it. The owner's cards therefore arrive
        // interleaved with the rivals' offers, which is invisible: nothing
        // between the two can reach a hand.
        if (task.pid !== owner) drawN(fx, owner, task.src, 1);
        return true;
      },
    },
  },
};

/**
 * W15 The Patisserie - "Put the top card of each deck into your barn."
 * Threshold 1, activation wild.
 */
export const patisserie: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'No choice at all - every deck in play, one card each, straight to the barn. "Each ' +
      'deck" is each deck ON THE TABLE with cards left (the discard reshuffles as ' +
      'everywhere), so it scales with the seat count and delivers a rainbow barn in one ' +
      'activation. NO LONGER AN ACTION CARD (19/08/2026 - the ruling is in the module ' +
      'docblock). It is a threshold-1 wild GROW, so the card that pays for it also fills ' +
      'it and the harvest that empties it is a second action; the deck cards it takes go ' +
      'straight to the barn and never onto the stack, so the two do not interfere. The old ' +
      'note argued the ACTION gate was RIGHT here because the whole card is a quantifier ' +
      'with nothing to decide. That is still true of the text and is simply no longer how ' +
      'the game offers it. Difficulty 2 to 1: with the move plumbing gone this is a loop ' +
      "over the live decks and nothing else, which is W10 The Furrow's shape and W10's " +
      'score. The live-deck gate went with the move it gated - `liveDecks` returning ' +
      'nothing now just makes the activation a no-op, which is the same answer one step ' +
      'later. Watch-list: this and the reseed both pull off deck tops, and reshuffles per ' +
      'played deck is the number most likely to move badly.',
  },
  activate(fx, self) {
    for (const suit of liveDecks(fx.data, fx.state)) fx.deckTopToBarn(self.seat, suit);
  },
};

/** Decks on the table with cards left - the market's rule, and W15's "each deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/** W16 The Granary - "Whenever you harvest, Draw 1. Once per turn." */
export const granary: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'RULING (decided): once per harvest, not once per building - otherwise The Bakery ' +
      'draws eight. The guard USED to be the event stream (fire only if this is the first ' +
      "`harvested` of the seat's in the current apply), and this note documented its own " +
      'hole: a harvest CHAINED through a task answer (W8, W11) is a separate apply and ' +
      "drew again, as did the upgraded Farmstead's repeat. So on a good Wheat turn it " +
      'drew two or three times. Rule change 12(c) (adopted 2026-08-11 with the Apiary ' +
      "rebuild) says no card's text may fire twice in a turn, and this was out of step " +
      'with it exactly as D16 was; the rebalance (2026-08-12) takes the same edit, onto ' +
      'the shared `turn.firedThisTurn` guard via `markFired` (runtime.ts, THE ONE WRITER ' +
      'of that list). A rule alignment, not a nerf. ✅ Safe for a Power card, CHECKED not ' +
      'assumed: growOptions and activateTargets filter the list but also require ' +
      "activationType !== null, and W16's is null; the two sow-target filters " +
      '(actions.ts sowTargets, tasks.ts) also read it, and W16 has threshold null, which ' +
      'makes canPlace false, so it was never a legal sow target to remove. A card-ability ' +
      'draw: no Orchard modifier (DL-47).',
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (fx.state.turn.firedThisTurn.includes(self.card)) return;
      markFired(fx, self.card);
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/**
 * W17 The Pie Shop - "Whenever a neighbour visits you, Draw 1." (v33 sheet,
 * Dean, 04/09/2026.)
 *
 * ⭐ IT IS THE HOST-SIDE PAYMENT, AND IT IS THE ONLY ONE IN THE GAME. The
 * meeple-loop diagnosis was that the v31 hook failed partly because being
 * visited paid the host NOTHING; Collect answers that structurally (the meeples
 * on your board come home as stored actions) and this card answers it in cards.
 * It is the mirror of O16 The Fruit Store, which pays its owner for GOING OUT on
 * the same hook.
 */
export const pieShop: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⛔ RE-KEYED 04/09/2026, AND THE OLD HANDLER WAS A DEAD CARD. It used to listen on ' +
      "`afterPlacement` for a rival placing a card on one of the owner's buildings, which " +
      'was the v31 visit fee landing on the Notice Board plus the odd cross-table sow (A8). ' +
      'The meeple loop places NO CARD ON ANY BOARD and the Notice Board is not a building at ' +
      'all, so under the shipped rules that listener fired on essentially nothing: the card ' +
      'was printing text the engine could not deliver. Dean retexted it on the v33 sheet to ' +
      '"Whenever a neighbour visits you, Draw 1" and it now keys on `afterVisit`, which is ' +
      'the event the currency change was deliberately built to leave alone. ' +
      '⚠️ cards.json STILL CARRIES THE OLD WORDING. The sheet is the single source of truth ' +
      'for text and cards.json is regenerated from it, not hand-edited, so the divergence is ' +
      'recorded in to-do/sync-ledger.md rather than patched here. Read the behaviour off ' +
      'this handler and the wording off the v33 sheet. ' +
      "TWO GUARDS, and both are the card's own words. `event.host === self.seat` makes it " +
      'HOST-side, which is the whole point of the retext - it pays for being visited, not ' +
      'for visiting. `!event.self` makes it a NEIGHBOUR: under the shipped meeple currency ' +
      'that is true by construction (X5, there is no self-visit under any flag) and the ' +
      'guard costs nothing, but overlays/v31-card-visit.overlay.json puts self-visiting back ' +
      'on the table and without it a seat would pay itself a card for every bonus slot it ' +
      'ever spent, with nobody else at the table involved. ' +
      "THE ONCE-A-TURN GUARD is the standing rule (12(c), 2026-08-11: no card's text fires " +
      'twice in a turn), taken through the shared `turn.firedThisTurn` list via `markFired` ' +
      'exactly as W16 The Granary does. Nothing in the shipped turn can produce two visits - ' +
      'one bonus slot, and A Helping Hand grants one Visit AND one Collect rather than two ' +
      'of either - so today it is belt-and-braces. It is written anyway because the rule is ' +
      'general and the next card that widens the bonus slot should not have to remember this ' +
      "one. crossPlayer: it fires for its owner in the middle of a rival's turn, which is " +
      "also why the guard reads the visitor's `firedThisTurn` and not the owner's - there " +
      'is one turn in progress and one list.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.host !== self.seat) return;
      // "a NEIGHBOUR visits you" - your own visit to your own board is not one.
      // False by construction under the meeple currency; live under the v31
      // card-visit control overlay.
      if (event.self) return;
      if (fx.state.turn.firedThisTurn.includes(self.card)) return;
      markFired(fx, self.card);
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** W19 The Wheat Exchange - "Game end: 2 VP for each different crop among the buildings you have built." */
export const wheatExchange: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Tableau VARIETY - the one endgame card in the suit that points away from ' +
      'monoculture, which is what the Innovation lens asks of a scaling layer whose ' +
      'metric axis is otherwise the specialisation axis. Crop is the printed icon ' +
      '(query.cropOf, ticket 07): a base starter prints the generic starting-building icon ' +
      'and belongs to no crop, an upgraded one prints its crop and counts. Caps at 10.',
  },
  gameEnd(data, state, seat) {
    const crops = new Set(
      player(state, seat)
        .tableau.map((b) => cropOf(data, b))
        .filter((crop): crop is Suit => crop !== null),
    );
    return 2 * crops.size;
  },
};

/** W20 The Grand Granary - "Game end: 1 VP for each building you have built." */
export const grandGranary: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The size of the farm. It counts BUILDINGS now rather than empty ones, because the ' +
      'reseed means a FIELD is never empty. READING: "you have built" is the deck-built ' +
      'set - the four starters arrive pre-built and nobody built them, so counting them ' +
      'would hand every holder a flat 4. Covered cards (D11) are not buildings and do not ' +
      'count, which is the same rule every other formula in the game applies to them.',
  },
  gameEnd(data, state, seat) {
    return player(state, seat).tableau.filter((b) => cardById(data, b.card).inDeck).length;
  },
};

/** W21 The Bread Hall - "Game end: 2 VP for each FIELD you have built." */
export const breadHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'FIELD density, the third of three tableau shapes (W19 wide across crops, W20 wide ' +
      'across buildings, this deep in FIELDs). It no longer scores coins, so its ' +
      '`replacesCoinPity` declaration is gone: nothing in the game converts coins to VP, ' +
      'and the card that used to reward hoarding against the market now rewards the thing ' +
      'the suit is built out of. CAPPED at 6 by the rebalance (2026-08-12), which is a ' +
      'TEMPLATE fix and not a balance one: an uncapped "for each" on the axis the suit ' +
      'specialises in is the exact shape docs/innovation.md warns about, and every other ' +
      'endgame scaler in the game carries a cap or a divisor. ⚠️ Expect it to move ' +
      'NOTHING - the card measures 0.44 VP a game, 0.98% of a winning score. If it moves ' +
      'something, that is the finding rather than the fix. A HOLDING fix either way: a ' +
      'proper re-point is still owed (wheat-rebalance-v1.md §6).',
  },
  gameEnd(data, state, seat) {
    return Math.min(6, 2 * ownFields(data, state, seat).length);
  },
};
