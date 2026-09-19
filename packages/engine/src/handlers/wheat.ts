/**
 * Wheat handlers - all 21 cards, REBUILT (docs/wheat-suit-rebuild-v5.md). Card
 * texts are quoted from cards.json (the sheet is the single source of truth for
 * wording).
 *
 * ⭐ v42 (16/09/2026): the sheet dropped the FIELD noun from card text, so W6 and
 * W12 now read "your Wheat buildings" (`cropBuildingsOf`, buildings.ts), and
 * "HARVEST:" prints as "When Harvested:". W9, W10, W13 and W15 were retexted.
 * W16 and W17 lost the once-per-turn guard: Dean ruled on 15/09/2026 that card
 * text fires every time its trigger happens, and the only per-turn cap left is
 * that a building activates at most once a turn (the runtime keeps that).
 * W21 counts receipt crops since v42, so no card text reads `isFieldCard` any
 * more; it stays exported from the engine's public surface.
 *
 * ⭐ v45 (19/09/2026, tasks/v45-rulings-v1.md): three more retexts. W5's HARVEST
 * loses its seed line and moves to a flat "Draw 3" - the LAST card in the file
 * to print the seed-corn line, so `reseed()` is deleted outright rather than
 * kept for a caller that no longer exists. W13 The Bakery no longer harvests
 * itself ("each of your OTHER buildings ... not this one"), which means the
 * card it is paid with now stays stuck on its own stack - a deliberate
 * self-clog (R10), not a bug. W16 The Granary gains a condition, "if you have
 * 5 or fewer cards" (hand only, R7), checked FRESH at the moment each draw
 * would fire rather than once per turn (R8), so a cascade can stop paying
 * part way through as the hand fills.
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
 * densest paragraph in the suit. ⛔ `reseed` is GONE (v45, 19/09/2026): W5 was
 * the last card calling it and the sheet has dropped the line from W5 too.
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

import { fireHook } from '../fx.js';
import type { Fx } from '../fx.js';
import { cardById, cropOf, drawableSuits, isHarvestable, player } from '../query.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import {
  cropBuildingsOf,
  deckSowRiders,
  deckSowTask,
  isNoticeBoardCard,
  ownBuildings,
} from './buildings.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

const FIELD_NAME = /\bField\b/;

/** FIELD sub-type membership, by whole-word title keyword (reference DL-42). */
export function isFieldCard(data: GameData, id: CardId): boolean {
  return FIELD_NAME.test(cardById(data, id).name);
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/**
 * ⛔ THE SHARED FIELD LINE IS GONE (v45, 19/09/2026, housekeeping beside R6-R10
 * in tasks/v45-rulings-v1.md): **"Sow 1 deck card onto this FIELD"** used to sow
 * the top card of any deck onto THE FIELD THAT JUST HARVESTED, via a
 * file-local `reseed()` helper. W5 Rye Field was the last card printing the
 * line (v30, 19/08/2026, took it off W6/W7/W8; W4 lost its own call the same
 * week) and the v45 sheet drops it from W5 too - "Draw 1. / When Harvested:
 * Draw 3." is the whole card now - so `reseed()` lost its only caller and is
 * deleted rather than kept unreferenced. The shared deck-sow PRIMITIVE this
 * built on, `deckSowTask`/`deckSowRiders` (buildings.ts), stays: A18 Helping
 * Hand still uses it, and the history above (narrowed target, mandatory
 * wording) is a record of what THIS card did, not of the primitive.
 */

/** Is this hook event THIS building being harvested by its own owner? */
function harvestedSelf(
  event: { seat: Seat; building: CardId },
  self: { seat: Seat; card: CardId },
): boolean {
  return event.seat === self.seat && event.building === self.card;
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
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour of its own, and no printed text to have behaviour about (cards.json ' +
      'carries an empty abilityText on all five Barns). Registered anyway, because ' +
      '"every enabled card has a handler" is the test that catches a card nobody has ' +
      'implemented, and a Barn with no entry would read as an oversight rather than as ' +
      'a deliberate blank. ' +
      '⭐ ENDGAME IS TRUE SINCE 10/09/2026, AND THE FLAG IS STRUCTURAL RATHER THAN A ' +
      'taste: the card carries a `gameEnd` now. Under the notice-board visit (S1) the ' +
      'crop scorer - "Game end: 1 VP for each <CROP> card you have built" - moves off ' +
      'the Farmstead onto the Barn, which is the starter whose one job is to hold your ' +
      'harvested cards. `barnCropScorer` answers 0 in every other game, so the printed ' +
      'behaviour is still nothing at all in the shipped commons and in all four ' +
      'controls. Every other flag stays false: no prompt, no move, no hook, nothing ' +
      'cross-table.',
  },
  /**
   * ⭐ THE CROP SCORER, WHICH LANDS HERE UNDER THE NOTICE-BOARD VISIT ONLY
   * (S1, Dean 10/09/2026): *"Game end: 1 VP for each Wheat card you have
   * built."* Under that rejig each starter does exactly one thing - the Notice
   * Board prints your suit's power and holds the visit fees, the Barn holds
   * your harvested cards and prints this line, and the Farmstead holds six
   * island receipt tokens and prints nothing at all.
   *
   * ⚠️ AND IT IS SILENT IN EVERY OTHER GAME. `barnCropScorer` answers 0
   * unless `rules.turn.visitCurrency` is `'noticeBoardPower'`, so the shipped
   * commons, the v31 control, the meeple controls and the coins arm all score
   * exactly as they did - the Farmstead keeps the line in the first four and
   * loses it with nowhere to go in the fifth (K13). The two are gated by the
   * same predicate from opposite sides, so the term can never be scored twice
   * or dropped.
   */
  gameEnd: barnCropScorer('wheat'),
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
 * W3 Notice Board (starter) - shipped text, sheet v44 (19/09/2026): "Harvest
 * one of your buildings, even if it is 1 card short of full." Threshold `3+`,
 * wild activation.
 *
 * ⚠️ STALE HISTORY, KEPT FOR THE RECORD: this docstring used to describe the
 * v31-era board ("VISITOR: place 1 card here, then Harvest one of your full
 * buildings", threshold 2, a £1-or-door choice) - a game three rulings out of
 * date (C88 of 10/09/2026 moved the board's power off a plain full-buildings
 * Harvest and onto its own text; the two-board visit of 11/09/2026 changed
 * who may be visited; today's retext changed the text again). None of that
 * survives; read the current mechanism below.
 */
export const wheatNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - the fee landing on the board, the harvest that ' +
      "follows and the board's own `3+` never-clogs threshold - is engine-level. The fee and " +
      'the door dispatch are `doVisit`/`doNoticeBoardVisit` in `actions/bonus.ts`; the power ' +
      "itself, this card's real behaviour, is the 'wheat' case of `fireNoticeBoardPower` in " +
      '`workers.ts`, gated by `rules.economy.noticeBoardPower.wheatHarvestGate` (SHIPPED ' +
      "'nearFull' since 19/09/2026; see that knob's comment in `types.ts`/`knobs.ts` for the " +
      'ruling in full, including the reversal of the 15/09/2026 rule that a Notice Board is ' +
      'never harvested below 3). `wheatBarn`, the old hand-to-barn rider, is retired to 0 the ' +
      'same day. ' +
      '⚠️ Threshold `3+` is a MINIMUM, never blocks, and the board is never full for the ' +
      'ordinary Harvest gate - see `noticeBoardThreshold` / `noticeBoardBlocks` in rules.json.',
  },
};

/**
 * W4 Wheat Field - "Draw 1. / When Harvested: Put 1 card from your hand into
 * your Barn." (v42 wording; behaviour unchanged.)
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
 * W5 Rye Field - "Draw 1. / When Harvested: Draw 3." (v45, 19/09/2026: was
 * "Draw 2. Sow 1 deck card onto this building." - the sow line is deleted and
 * the harvest draw moves 2 to 3, its only remaining number. W5 was the last
 * card in the suit printing the seed line (v30, 19/08/2026), so `reseed()` has
 * no caller left anywhere in the file and is deleted with it - see the note
 * where it used to live, above `harvestedSelf`.)
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
      drawN(fx, self.seat, self.card, 3);
    },
  },
};

/**
 * W6 Barley Field - "Draw 1. / When Harvested: Sow 1 card from your hand onto
 * each of your Wheat buildings." (v42)
 */
export const barleyField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v42: "each of your Wheat buildings", no longer "each of your FIELDs", so a Wheat ' +
      'Tier 2 or Tier 3 card takes a sow as well, and the text says "from your hand" again. ' +
      'One task per Wheat building you own at the moment of harvest, in tableau order. ' +
      'The older note follows. ' +
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
      for (const b of cropBuildingsOf(fx.data, fx.state, self.seat, 'wheat')) {
        fx.pushTask({
          t: 'sow',
          pid: self.seat,
          src: self.card,
          remaining: 1,
          targets: [{ seat: self.seat, card: b.card }],
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

/**
 * W9 Mill House - "Sow a deck card on up to 3 of your buildings that are empty."
 * (v42; was "Sow the top card of any deck onto each of your FIELDs".)
 */
export const millHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ v42: up to three of your buildings whose stack is EMPTY, any suit, one deck card ' +
      'each. One `deckSow` task (buildings.ts) asks for one deck and one building at a ' +
      'time, three times at most, with a stop answer ("up to"); a building that took a card ' +
      'leaves the list, and "empty" is re-checked as each card lands. Never a Notice Board ' +
      '(S11) and never a Power or Endgame card (no stack). W9 itself holds its own grow ' +
      'payment when this fires, so it is never one of its own targets. The older reading, ' +
      'one deck top per FIELD, was the supply card the scaling layer needed; the new text ' +
      'trades the scale for a reach across every suit.',
  },
  activate(fx, self) {
    const targets = ownBuildings(fx.data, fx.state, self.seat)
      .filter((b) => !isNoticeBoardCard(fx.data, b.card))
      .map((b) => ({ seat: self.seat, card: b.card }));
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'deckSow',
      riders: deckSowRiders({
        remaining: 3,
        targets,
        distinct: true,
        optional: true,
        emptyOnly: true,
      }),
    });
  },
  tasks: { deckSow: deckSowTask() },
};

/** W10 The Furrow - "Put exactly 3 cards from your hand into your Barn." (v42) */
export const furrow: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "⭐ v42: exactly three hand cards, of the owner's choosing, where it used to take the " +
      'whole hand with no choice. One `handToBarn` task with `remaining` 3, not optional ' +
      '("exactly"). ⭐ BUILDER DEFAULT (16/09/2026): a hand of fewer than three banks what ' +
      'it has, rather than making the card illegal to grow; the task is sized to ' +
      'min(3, hand) so it never waits on a card that is not there. Watch-list: an empty ' +
      'hand cannot visit, so a Furrow turn can still cost the hook a turn.',
  },
  activate(fx, self) {
    const n = Math.min(3, player(fx.state, self.seat).hand.length);
    if (n === 0) return;
    fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: n });
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

/**
 * W12 Crop Rotation - "Harvest every Wheat building with 1 or more cards on it."
 * (v42; was "every FIELD".)
 */
export const cropRotation: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ v42: every one of your Wheat buildings (`cropBuildingsOf`), not every FIELD, so ' +
      'the Tier 2 and Tier 3 Wheat cards are harvested too. ⭐ BUILDER DEFAULT ' +
      '(16/09/2026): W12 IS a Wheat building, and its grow payment is on its stack when ' +
      'this fires, so it harvests ITSELF, exactly as W13 always has. The older note, which ' +
      'said it never harvests itself because it is not a FIELD, follows. ' +
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
    const ready = cropBuildingsOf(fx.data, fx.state, self.seat, 'wheat')
      .filter((b) => b.stack.length >= 1)
      .map((b) => b.card);
    harvestCascade(fx, self.seat, ready);
  },
};

/**
 * W13 The Bakery - "Harvest every one of your buildings, however many cards are
 * on them (including 0)." (v42) Threshold 1, activation wild.
 */
export const bakery: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      '⭐ v45 RETEXT (19/09/2026, R6 and R10, tasks/v45-rulings-v1.md): "Harvest each of ' +
      'your OTHER buildings (not this one) with at least 1 card on it" - two changes from ' +
      'v42\'s "every one of your buildings, however many cards are on them (including 0)". ' +
      'First, the gate is now "1 or more", not "including 0": an empty building is no ' +
      'longer harvested, so its own "When Harvested:" line and the "whenever you harvest" ' +
      'cards (W16) fire only for a building that actually held something. Second, W13 IS ' +
      'NO LONGER IN ITS OWN SET (self-excluded by card id, not by the stack-size filter) - ' +
      'the whole reason the old note had to explain why harvesting itself was correct is ' +
      'moot, because it does not happen any more. ⭐ THE CONSEQUENCE (R10, Dean shown and ' +
      'accepted, ship as written, no workaround): W13 is threshold 1 and now excludes ' +
      'itself, so the card paid to grow it stays on its own stack and W13 clogs on its own ' +
      'fee every single use - an ordinary Harvest is needed before it can fire again. The ' +
      'old face scooped its own payment straight back; this one does not. A Notice Board ' +
      'is still never harvested below its 3+ minimum, by this card or any other; Power and ' +
      'Endgame cards are still not buildings and are still skipped. ' +
      '⛔ NO LONGER AN ACTION CARD (19/08/2026). The ACTION concept was RETIRED from the ' +
      'game on Dean\'s ruling - "The concept of an ACTION was never requested. They are all ' +
      'GROW." - and W13 was the first card ever written in that shape, so it is the one ' +
      'whose note has to record the seam that is gone: `actionMoves` / `moves` / ' +
      '`applyMove`, with `applyMove` setting `turn.actionSpent` itself and `moves` gating ' +
      'on it being unspent. All of it is deleted. The card is now an ordinary GROW ' +
      'building at threshold 1 with a wild activation, so it costs a card and the main ' +
      'action like everything else. ' +
      '"Each of your OTHER buildings" - the Notice Board and the Service unclog too, which ' +
      'is the largest part of what the card is for. It prompts through what it harvests. ' +
      'Order cannot matter - per-harvest listeners see each harvest separately. It no ' +
      'longer needs a "have I anything to harvest" gate: a farm with nothing else loaded ' +
      'makes the cascade a no-op, and a GROW that does nothing is a choice the owner made ' +
      'rather than a move the engine offered.',
  },
  activate(fx, self) {
    const others = ownBuildings(fx.data, fx.state, self.seat).filter(
      (b) =>
        b.card !== self.card &&
        b.stack.length >= 1 &&
        (!isNoticeBoardCard(fx.data, b.card) || isHarvestable(fx.data, b)),
    );
    harvestCascade(
      fx,
      self.seat,
      others.map((b) => b.card),
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
 * W15 The Patisserie - "Put 3 deck cards of one deck into your Barn." (v42; was
 * "the top card of each deck".) Threshold 1, activation wild.
 */
export const patisserie: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '⭐ v42: ONE choice, the deck, then its top three cards straight to the barn. A ' +
      'custom `patisserieDeck` task answers one deck per live deck on the table (at most ' +
      'five answers), and the three cards come off that deck one at a time, so a deck that ' +
      'runs out mid-way reshuffles its own discard as everywhere. It is a colour-control ' +
      'card now, where it used to deliver a rainbow barn. The older note follows. ' +
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
    if (liveDecks(fx.data, fx.state).length === 0) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'patisserieDeck', riders: {} });
  },
  tasks: {
    patisserieDeck: {
      answers(data, state) {
        return liveDecks(data, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('patisserieDeck expects a card answer');
        const suit = answer.payload.suit as Suit;
        for (let i = 0; i < 3; i++) fx.deckTopToBarn(task.pid, suit);
        return true;
      },
    },
  },
};

/** Decks on the table with cards left - the market's rule, and W15's "one deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/** W16 The Granary - "Whenever you harvest, Draw 1." */
export const granary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v45 RETEXT (19/09/2026, R7 and R8, tasks/v45-rulings-v1.md): the draw is now ' +
      'conditional, "if you have 5 or fewer cards" - HAND ONLY (R7), never the barn or a ' +
      "building's stack - and the condition is checked FRESH at the moment this card's " +
      'draw would actually happen, not once per turn and not at the moment the harvest ' +
      'fires (R8). That is why the push below (`afterHarvest`) queues a CUSTOM task ' +
      '(`granaryDraw`) rather than calling `drawN` straight away: every harvest in a ' +
      'cascade (W13, W12) is still synchronous, so pushing an unconditional draw at push ' +
      'time would see the SAME hand size for every building in the cascade and could ' +
      "never stop partway through. `granaryDraw`'s `answers()` is instead computed fresh " +
      'each time this task reaches the head of the queue (`taskAnswers`/`drainTasks`, ' +
      'tasks.ts), by which point every task queued in front of it - including an EARLIER ' +
      'granaryDraw from the same cascade - has already resolved and changed the hand. ' +
      'That is what makes "fresh each time" possible without a second guard, and it is ' +
      'the deliberate brake on the W13-plus-W16 combination the ruling names: a cascade ' +
      'stops paying itself the moment the hand crosses 5. ' +
      '⭐ THE ONCE-PER-TURN GUARD IS GONE (Dean, 15/09/2026): card text fires every time ' +
      'its trigger happens, and each building harvested is its own trigger, so W13 The ' +
      'Bakery emptying several buildings can draw several times - now capped only by the ' +
      'hand condition above, not by a per-turn count. The only per-turn cap left in the ' +
      'game is that a building activates at most once a turn, and the runtime keeps that. ' +
      'The older note below argued the guard and is history. ' +
      'RULING (superseded 15/09/2026): once per harvest, not once per building - otherwise The Bakery ' +
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
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'granaryDraw', riders: {} });
    },
  },
  tasks: {
    granaryDraw: {
      /**
       * The condition, evaluated fresh: HAND ONLY (R7), 5 or fewer. Reads
       * `state` live rather than anything snapshotted at push time, which is
       * the whole mechanism - see the docblock above.
       */
      answers(data, state, task) {
        if (player(state, task.pid).hand.length > 5) return [];
        return drawableSuits(data, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
      },
      /**
       * Resolved IN ONE STEP, unlike `drawN`'s ordinary see-N/keep-N task:
       * this must land the card in the hand synchronously, in the same
       * `answerTask` call that answers it, because the NEXT `granaryDraw` in
       * a cascade reads the hand fresh as soon as this one is popped (R8). A
       * two-phase draw (choose deck, then a separate keep step) would leave
       * the hand unchanged until its second step and the freshness would
       * never bite. `fireHook('afterDrawKeep', ...)` is called by hand for
       * the same reason `drawN`'s task does - nothing in the catalogue
       * listens to it yet, but this is a real draw and should look like one.
       */
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('granaryDraw expects a card answer');
        const suit = answer.payload.suit as Suit;
        const card = fx.takeDeckTop(suit);
        if (card !== null) {
          fx.cardsToHand(task.pid, [card]);
          fireHook(fx, 'afterDrawKeep', { seat: task.pid, cards: [card] });
        }
        return true;
      },
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
      '⭐ THE ONCE-A-TURN GUARD IS GONE (Dean, 15/09/2026): card text fires every time its ' +
      'trigger happens, so two visits in one turn (A Helping Hand at two seats, where one ' +
      'rival holds both boards) draw two. The paragraph below that argues the guard is ' +
      'history. ' +
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

/**
 * W20 The Grand Granary - "Game end: 1 VP for each building you have built
 * (Max 5VP)." (the cap moved onto the printed card at v44, 18/09/2026; see
 * `rules.economy.grandGranaryCap`, shipped 5.)
 */
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
    const count = player(state, seat).tableau.filter((b) => cardById(data, b.card).inDeck).length;
    const cap = data.rules.economy.grandGranaryCap;
    return cap === null ? count : Math.min(cap, count);
  },
};

/**
 * W21 The Bread Hall - v41/v42: "Game end: 2 VP for each different RECEIPT suit
 * you have delivered."
 */
export const breadHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'RETEXTED ON v41 (15/09/2026), and it needs R7: a receipt keeps the crop of the token ' +
      "it was (the token island, 16/09/2026). Counts the DISTINCT crops among the seat's " +
      'receipts, a receipt beyond six included. ⚠️ BUILDER DEFAULT (handoff §5 item 7): a ' +
      'WILD receipt is a suit of its own, so at most 6 distinct suits and 12 VP. ' +
      '⛔ The old FIELD count ("2 VP for each FIELD you have built") and its cap of 6 are ' +
      'gone with the text; the cap was a template fix for a count on the specialisation ' +
      'axis, and a count of DIFFERENT receipt crops runs across that axis instead.',
  },
  gameEnd(_data, state, seat) {
    return 2 * new Set(player(state, seat).receipts.map((r) => r.crop)).size;
  },
};
