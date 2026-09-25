/**
 * Orchard handlers - all 21 cards, REBUILT (docs/orchard-suit-rebuild-v5.md,
 * landed from docs/orchard-rebuild-engine-handoff-v1.md). Card texts are quoted
 * from cards.json (the sheet is the single source of truth for wording).
 *
 * Suit identity: Draw - and the rebuild's thesis is that the drawing was never
 * the problem. Orchard wins 80.8% of simulated games because rival cards land
 * on its Service and its owner harvests them into a barn worth 80% of a winning
 * score. NOTHING IN HERE FIXES THAT AND NOTHING IS TRYING TO. What the rebuild
 * does is stop the deck pushing the same way: O16 is turned around to pay for
 * GOING OUT instead of for being visited, and no Tier 1 reaches the barn any
 * more.
 *
 *     The ramp:       cards through your hands, not cards IN your hand.
 *     The bottleneck: the hand. Size 4, and it empties three ways - a GROW, a
 *                     build, a visit.
 *     The signature:  Orchard never throws anything away. What it turns down
 *                     goes to a neighbour.
 *
 * Three structural things are new to the engine here:
 *
 *   1. **The DISCARD DIVERT SEAM** (`tasks.ts`, the `divert` task). Both new
 *      starter powers and one Power card act on the same moment - the card a
 *      see/keep draw throws away - and they are mutually exclusive per card by
 *      construction, so it is one seam and not two. The rebuilt Farmstead gives
 *      that card to a neighbour (+£1 upgraded); O17 The Fruit Basket buys it
 *      into the barn for £1. ⛔ NEITHER HALF SURVIVES: the Farmstead is an
 *      end-game scorer (v31) and O17 moved onto the BUILD PAYMENT and lost its
 *      price, then gained a once-per-turn cap (v32). The seam itself is still in
 *      the engine with no card declaring `divertsDiscard`. This file used to
 *      contribute the O17 half as a one-line
 *      `divertsDiscard` declaration and nothing else.
 *   2. **The Farmstead is a keep, not a look.** `withDrawModifier` now returns
 *      see +1 / keep +1 on BOTH faces (the upgrade buys coins, not cards).
 *   3. **Tier 3 was three ACTION cards and is now three ordinary GROW
 *      buildings** (19/08/2026). O13, O14 and O15 printed no threshold and no
 *      activation type; they offered a standing move that WAS the main action,
 *      through the shared helpers in `actionCard.ts`. Dean retired the whole
 *      concept - *"the concept of an ACTION was never requested. They are all
 *      GROW."* - so the sheet's threshold (1 / 1 / 2) and wild activation type
 *      are what the engine reads, the GROW runtime spends the action, and
 *      nothing in this file declares `actionMoves` any more. O13 is still the
 *      re-entrant one: it performs a REAL GROW on each of the owner's ORCHARDs
 *      in turn, paying each cost as it goes, and re-queues itself behind each
 *      activation's own tasks so the order is the player's and the draws land
 *      before the next choice.
 *
 * ✅ **THE D1 RULING IS CLOSED - OPTION A SHIPPED** (19/08/2026). Every other
 * suit derives its sub-type from a whole-word title keyword (FIELD, HIVE,
 * DEPOT - reference DL-42). Orchard's names used not to cooperate: The Grand
 * Orchard, The Orchard Keeper and The Orchard Archive all carried the word and
 * none of them was one, which under the keyword rule would have had O13 trying
 * to grow itself and O20 paying up to 16 VP against a winning score of 38. So
 * ORCHARD was defined here as the suit's TIER 1 cards - O4 to O8 - and nothing
 * else (option B: cheap, reversible, and never the one that was meant to ship).
 *
 * The v30 rename pass IS option A. O13 is now The Seed Bank, O16 The Fruit
 * Store and O20 Crop Diversity, so the word "Orchard" survives in exactly five
 * card names - O4 to O8 - and the title-keyword reading and the Tier 1 reading
 * now pick out the SAME five cards. `isOrchardCard` deliberately keeps the Tier
 * 1 test rather than switching to the regex: the two agree, so the switch would
 * buy nothing and would hand a future renamer the power to change three cards'
 * behaviour by editing a name. The test file pins the agreement, which is what
 * catches it if a rename ever breaks the tie again.
 *
 * ⭐ v42 (16/09/2026): THE ORCHARD NOUN IS GONE FROM THE CARD TEXT, and so is
 * every reader of `isOrchardCard` bar the simulator. The Tier 1 cards are GROVEs
 * by name (The Apple Grove and so on; the handler exports keep their old
 * identifiers), and the cards that counted ORCHARDs now read "your Orchard
 * buildings" (`cropBuildingsOf`, buildings.ts, O7 and O10), "one of your
 * buildings" (O11), "up to 2 of your other buildings" (O13) or a VP value (O20).
 * O16 lost its once-per-turn guard (Dean, 15/09/2026: card text fires every
 * time its trigger happens); O17 keeps its own, because it PRINTS "Once per
 * turn". The paragraphs above that say ORCHARD are history.
 */

import type { GameData, Suit } from '@gp/data';

import { deliverOptions, doDeliver, freeHandSpace, growOptions } from '../actions.js';
import type { Fx } from '../fx.js';
import { canSowOnto, cardById, player } from '../query.js';
import { doGrow } from '../runtime.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { builtBuildingsWorth, cropBuildingsOf } from './buildings.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

/**
 * ORCHARD sub-type membership. See the closed D1 ruling in the file header: the
 * five TIER 1 cards and nothing else. Since the v30 renames that set is also
 * exactly the set of cards whose names contain the whole word "Orchard", so
 * this no longer contradicts the printed names - it is the same answer reached
 * by a route a rename cannot move. ⭐ No card reads it since v42 (16/09/2026):
 * O7, O10, O11, O13 and O20 were all retexted off the noun. Kept exported for
 * the simulator.
 */
export function isOrchardCard(data: GameData, id: CardId): boolean {
  const card = cardById(data, id);
  return card.suit === 'orchard' && card.type === 'tier1';
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck; no Farmstead modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/**
 * O14 The Conservatory's printed draw. Named rather than inlined because it is
 * the card's one dial and the v32 ruling put it on the sheet: it used to be an
 * engine reading of "a full hand" off `rules.setup.startingHand`, and it is a
 * printed 4 now, so a change here is a card change and belongs on the sheet.
 */
const CONSERVATORY_DRAW = 4;

/**
 * Rivals who could physically accept a gift right now (DL-63).
 *
 * ⭐ DL-63 IS LIVE AGAIN (02/09/2026). The rule is that a gift never forces an
 * out-of-turn discard, so a rival already at their hand limit drops out of the
 * list. v31 deleted the hand limit and this filter went moot with it - the file
 * said "moot, not repealed", and named this as the one function that would have
 * to learn about a cap again. It has. The reinstated limit is
 * `rules.turn.handLimit`, one global number, so `freeHandSpace` answers for
 * every seat off one rule rather than off five printed Barn faces.
 *
 * ⚠️ WITHOUT IT THE ORCHARD GIFTS STOP BEING GIFTS. A give to a rival already at
 * 12 cards would cost them a card at their own turn boundary, which turns O6 and
 * O9 from "your junk is their treasure" into a way to make a neighbour discard -
 * a different card, and a much nastier one than the design asked for.
 */
function giftableSeats(data: GameData, state: GameState, pid: Seat, already: Seat[]): Seat[] {
  const out: Seat[] = [];
  for (let seat = 0; seat < state.players.length; seat++) {
    if (seat === pid || already.includes(seat)) continue;
    if (freeHandSpace(data, state, seat) < 1) continue;
    out.push(seat);
  }
  return out;
}

/**
 * O1 Barn (starter) - prints NOTHING (v31).
 *
 * ⛔ Both lines went: the hand size with the hand limit itself, and the build
 * rider ("When you build an ORCHARD, Draw 2") with the other four. This one was
 * the biggest of the five - Draw 2 on the cheapest Tier 1 row in the game - and
 * it is what made a 2-cost ORCHARD card-neutral to build and the 1-cost Apple
 * card-POSITIVE. Losing it makes every ORCHARD card-negative to build, which is
 * the number to watch in this suit after v31: the card tax is a tax on total
 * cards again, not just on assembly. *
 * ⭐ THE HAND LIMIT CAME BACK ON 02/09/2026 AND THIS CARD DID NOT. The
 * reinstated limit is a flat 12 for everybody, in `rules.turn.handLimit` and
 * on the player aid; the Barn stays blank. A rule that applies to every seat
 * is not a card value, which is the whole difference between the old shape and
 * the new one - so nothing here should be un-deleted.
 */
export const orchardBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour of its own, and no printed text to have behaviour about. Registered ' +
      'so that a Barn with no entry reads as a deliberate blank rather than as a card ' +
      'nobody implemented. ' +
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
   * (S1, Dean 10/09/2026): *"Game end: 1 VP for each Orchard card you have
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
  gameEnd: barnCropScorer('orchard'),
};

/**
 * O2 Farmstead (starter) - "Game end: 1 VP for each Orchard card you have built."
 *
 * ⛔ THE DRAW MODIFIER AND THE DRAW GIFT ARE BOTH GONE (v31), and this card had
 * the most machinery of the five. `withDrawModifier` (query.ts) was the numbers
 * half - see +1 and keep +1, applied where a Draw ACTION's numbers were set and
 * deliberately never to card-ability draws (DL-47) - and `drawGiftPower` plus
 * the `divert` task was the other half, "give the discarded card to a
 * neighbour".
 *
 * TWO THINGS FROM IT ARE WORTH CARRYING. A draw modifier has to attach to the
 * ACTION, or every card that prints the word "Draw" fires it. And the gift
 * SCOPED ITSELF with no exception list: the base Draw was see 2 keep 1 so it had
 * exactly one discard to give, a door's Draw kept everything so it had none, and
 * the end-of-turn discard was not a draw - which closed the give-four-cards
 * exploit for free. In v31 the base Draw keeps both cards, so there would have
 * been nothing left to give in any case.
 */
export const orchardFarmstead: CardHandler = farmsteadHandler('orchard');

/**
 * O3 Notice Board (starter) - "VISITOR: place 1 card here, then Draw 3."
 * Threshold 2, wild activation.
 */
export const orchardNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the fee landing, the door action and the clog at threshold 2 are ' +
      'all engine-level. ' +
      '⭐ THIS IS THE ONE DOOR IN THE SET THAT IS NOT A PLAIN ACTION, AND THE EXCEPTION IS ' +
      'LOAD-BEARING (workers.json, v31). The self-cancellation law: a visitor pays 1 card to ' +
      'use a door, so a door whose action PRODUCES cards has to over-deliver or buying it is ' +
      "net zero. The bonus slot's other option is a free Draw 1, so a plain Draw 2 door " +
      'would cost 1 card and return 2 - exactly what the free option gives for nothing - and ' +
      'would be STRICTLY WORSE than its own alternative. Draw 3 nets +2. Tidy it to 2 for ' +
      'consistency with the other four and this door dies overnight, silently: nothing ' +
      'errors, the traffic simply goes somewhere else.',
  },
};

/**
 * O4 The Apple Grove - "Draw 3." (RETEXTED v44, 18/09/2026, from "Draw 2.";
 * named The Apple Orchard until v36.)
 */
export const appleOrchard: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The naked skeleton, and no longer priced as half of O5-O8 (each Draw 2 plus a further ' +
      'conversion, at cost 2): O4 stays at cost 1 but now draws 3, one more than the four it ' +
      "used to undercut. At cost 1 with the Barn refunding 2 it stays the suit's only " +
      'card-positive build, more so than before; unpriced against the other four, which this ' +
      'v44 change leaves untouched.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 3);
  },
};

/** O5 The Pear Grove - "Draw 2, then SOW 1 card from your hand onto this building." */
export const pearOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Converts into PLACEMENT: it fills itself, two cards per GROW, which is why its ' +
      'threshold is 4 where the other four are 3. The GROW payment is already on the stack ' +
      'when activate runs, so this is the second card of the turn onto it. Printed "SOW", ' +
      'not "you may", so the task is MANDATORY - it auto-skips on an empty hand or a full ' +
      'stack, which is the only way it can be declined. Sow is suit-free (2026-07-20).',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({
      t: 'sow',
      pid: self.seat,
      src: self.card,
      remaining: 1,
      targets: [{ seat: self.seat, card: self.card }],
    });
  },
};

/**
 * O6 The Cherry Grove - v48 retext (`tasks/v48-rulings-v2.md`, the builder-
 * default paragraph): "Draw 2, then Deliver." (was "Draw 2, then give 1 card
 * to a neighbour and Draw 1.")
 *
 * ⛔ THE CROSS-TABLE HALF IS GONE. The card no longer touches another player
 * at all: no give, no refund, no `giftableSeats` call. Draw 2 resolves first
 * (so a card just drawn may pay the delivery), then a plain, mandatory
 * Deliver off the shared `t: 'deliver'` task - the same shape V7 The Export
 * Depot already uses for "Harvest, then Deliver" - taking an ordinary
 * receipt, no relaxation and no extra source. With nothing payable the task
 * enumerates no answers and drops itself: "as much as it can" reads as
 * nothing at all on a dry barn.
 */
export const cherryOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "Converts into a plain DELIVER: this Tier 1 is now one of the suit's ordinary " +
      'routes onto the island rather than a card-back trade. The Draw 2 resolves first, ' +
      'so the payment may include a card just drawn; the Deliver that follows is the full ' +
      'action (a real receipt, the sixth-receipt trigger, V16 and V18 all fire) and is ' +
      'mandatory as printed, auto-skipping when the barn cannot pay any open tile.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
};

/**
 * O7 The Golden Grove - "Draw 2, then you may Harvest one of your Orchard
 * buildings." (v42 wording; named The Golden Orchard until v36.)
 */
export const goldenOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      '⭐ v42: any of your Orchard buildings (`cropBuildingsOf`), not just the Tier 1 ' +
      'ones. ⭐ THE GATE IS NOW THE PLAIN FULL HARVEST (16/09/2026): the text prints no ' +
      '"however many cards", so the chooser uses the `full` filter, where the older ' +
      'handler used `loaded` (1 or more cards) against its own note that "it does not ' +
      'skip the stack". The older note follows. ' +
      "Converts into an ACTION: the suit's self-harvest valve, which every non-Wheat suit " +
      'needs or its engine clog-locks. It does not skip the stack, it only saves the ' +
      'Harvest action. "One of your ORCHARDs" is the chooseBuilding `loaded` gate narrowed ' +
      'by the new `targets` list, and "you may" is its new `optional` flag; with no loaded ' +
      'ORCHARD the task enumerates nothing and drops itself.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      targets: cropBuildingsOf(fx.data, fx.state, self.seat, 'orchard').map((b) => b.card),
      optional: true,
      then: 'harvest',
    });
  },
};

/** O8 The Heritage Grove - "Draw 2, then you may Build." */
export const heritageOrchard: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'Converts into a BUILD, and it is the reserved slot - the one card in the suit that ' +
      'makes cards STAY where everything else keeps them moving. With the new Barn it is ' +
      'also the strongest card in the tier, because a build ACTION is the one resource ' +
      'nothing refunds (about 3.4 per player per game). The granted build is a real Build ' +
      'through the shared task, so it fires the Barn rider in turn: GROW Heritage, draw 2, ' +
      'build an ORCHARD with them, draw 2 more. That IS the opening engine and it is ' +
      'deliberate. ⚠️ Watch for the degenerate line - Heritage down early, then a building ' +
      "a turn; the dial the design names is Heritage's threshold, never the Barn.",
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({ t: 'build', pid: self.seat, src: self.card, optional: true });
  },
};

/**
 * O9 The Fruit Stand - "Give another player 1 card from your hand, then Draw
 * 4." (v47 retext of "Give 1 card to each neighbour. Draw 2 for each.")
 *
 * ⭐ v47 RETEXT (`tasks/v47-card-changes-engine-pass.md` T4c;
 * `tasks/v47-rulings-v1.md` R1). One give to ONE other player, the owner's
 * choice of both the card and the recipient (giftableSeats, DL-63), not a
 * loop over every neighbour. **R1: the Draw 4 is gated on the give actually
 * happening** - "a card that pays you for giving to a neighbour ... pays only
 * if the card reaches them" (R1's rule-book sentence; the same shape as A8's
 * gate and O6's refund). Because the give and the Draw 4 are one mandatory
 * task and the Draw 4 is pushed from inside `resolve`, an empty hand or every
 * rival at the hand bound (DL-63) leaves `answers` empty, `drainTasks` drops
 * the task silently, and NOTHING is drawn - there is no path to Draw 4
 * without a card crossing the table first. The re-entrant multi-neighbour
 * loop (`standTask`) is gone: one give, one payoff.
 * ⚠️ Engine-only wrinkle carried from the audit: the simulator's hand bound
 * can refuse a give to a rival who is full that a table with no hand limit
 * would still allow, so O9 is slightly understated in the simulator.
 */
export const fruitStand: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The noun is now ONE CARD TO ONE PLAYER, not a loop over every neighbour: the owner ' +
      'picks the card and the recipient (giftableSeats). Mandatory as printed - no skip ' +
      'answer - but the give can still fail to happen (empty hand, or every rival at the ' +
      'DL-63 hand bound), and per R1 that failure gates the WHOLE reward: the Draw 4 lives ' +
      "inside the give task's `resolve`, so it fires only when a card actually reached " +
      'another player. No give, no Draw 4. This is the same gate shape as A8 The Wild Hive ' +
      "(R2) and O6 The Cherry Grove's refund, now named as a rule-book sentence (R1).",
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'give',
      riders: {},
    });
  },
  tasks: {
    give: {
      answers(data, state, task) {
        const seats = giftableSeats(data, state, task.pid, []);
        return player(state, task.pid).hand.flatMap((card) =>
          seats.map((to) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('give expects a card answer');
        fx.giveCard(task.pid, answer.payload.to as Seat, answer.payload.card as CardId);
        // R1: the Draw 4 lives here, inside the give's own resolve, so it can
        // only ever fire once a card has actually crossed the table.
        drawN(fx, task.pid, task.src, 4);
        return true;
      },
    },
  },
};

/**
 * O10 The Cider House - "SOW 1 card from your hand onto each of your Orchard
 * buildings." (v42; was "each of your ORCHARDs".)
 */
export const ciderHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v42: one hand sow onto each of your Orchard buildings (`cropBuildingsOf`), every ' +
      'tier, O10 itself included when it has room. The older note follows. ' +
      'The noun is ORCHARDS YOU HAVE BUILT - the only Tier 2 whose clause grows with the ' +
      'tableau, which is what the tier is for. W9 The Mill House is the precedent (a deck ' +
      'top onto each FIELD); this one is HAND-sourced, so it is the colour-control card of ' +
      'the pair. One task per ORCHARD rather than one task with a count, because a full ' +
      'ORCHARD has to drop out on its own and each placement is a separate choice of card. ' +
      'With The Grand Orchard it is the midgame pair: fill every ORCHARD, then activate ' +
      'every ORCHARD. ⚠️ Shares its verb with O14 at a smaller scope - a two-rung SOW ' +
      'ladder, accepted deliberately as the lesser fault.',
  },
  activate(fx, self) {
    for (const b of cropBuildingsOf(fx.data, fx.state, self.seat, 'orchard')) {
      fx.pushTask({
        t: 'sow',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: b.card }],
      });
    }
  },
};

/**
 * O11 The Harvest Market - v48 retext (`tasks/v48-rulings-v2.md`, the
 * builder-default paragraph): "Harvest one of your buildings, then Draw 2."
 * (was "Harvest one of your buildings, then Draw 1 for each card harvested".)
 *
 * ⛔ THE PER-CARD DRAW IS GONE. The custom `marketHarvest` task is retired in
 * favour of the shared `chooseBuilding`/`then: 'harvest'` shape V7 The Export
 * Depot already uses ("Harvest ... then Deliver"): a plain Harvest of one
 * FULL building of any suit, O11 itself included if its own GROW payment
 * filled it (the face does not say "another"), a Notice Board counted full
 * at 3 or more (`isHarvestable`, through `fullBuildings`). The Draw 2 is a
 * flat, UNCONDITIONAL drawN, pushed alongside the harvest rather than out of
 * its resolve, so it fires whether or not a building was harvestable at all
 * (v47 R1: a reward after your own act, never gated the way a cross-table
 * payment is). Mandatory as printed; with nothing full the harvest task
 * enumerates no answers and is dropped silently.
 */
export const harvestMarket: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The noun is now a FLAT NUMBER, not a count of what was harvested: the harvest and ' +
      'the draw are two independent pushes, in printed order, and the draw no longer reads ' +
      'the harvested stack at all. A building the payment just filled counts (no "another"), ' +
      'and the queue order (harvest resolves before the draw, since tasks answer in queue ' +
      'order) is the only thing tying the two together.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      then: 'harvest',
    });
    drawN(fx, self.seat, self.card, 2);
  },
};

/**
 * O12 The Fruit Press - v48 retext (`tasks/v48-rulings-v2.md`, the builder-
 * default paragraph): "Deliver. You may spend 1 card from your hand in the
 * Delivery." (was "Put up to 4 cards from your hand into your Barn.")
 *
 * ⛔ NO LONGER A HAND-TO-BARN CARD AT ALL. It is a plain, mandatory Deliver
 * with one extra payment source T4b built for exactly this card: at most one
 * hand card, paying as its OWN crop (never wild, unlike V3's and V5's "any
 * crop" cards), still exactly `deliveryCost` cards in total. `deliverOptions`
 * is called with `handCard: true`, which folds in one additive candidate pool
 * per crop the hand holds - never multiplicative with the plain barn pool -
 * and names the crop on the option as `handCrop`, never the literal card (a
 * hand card carries identity a barn card does not, so naming the card would
 * multiply the answer count by hand size; naming the crop keeps it linear).
 * The literal card is chosen here, deterministically (the first hand card of
 * that crop), when the answer is resolved, and handed to `doDeliver` as
 * `choice.handCard`.
 */
export const fruitPress: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The noun moved from CARDS IN YOUR HAND to a plain ISLAND DELIVERY with one bridge ' +
      'card allowed in from the hand: the one exception in the game to "delivery is ' +
      'barn-only", printed on the card itself. Mandatory Deliver as printed, auto-skipping ' +
      'when nothing is payable even with the hand bridge; the hand card is never required, ' +
      'only ever a top-up when the barn is exactly one short.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'fruitPressDeliver',
      riders: {},
    });
  },
  tasks: {
    fruitPressDeliver: {
      answers(data, state, task) {
        return deliverOptions(data, state, task.pid, Infinity, 0, false, true).map(
          (o) =>
            ({
              kind: 'card',
              payload: { tile: o.tile, token: o.token, spend: o.spend, handCrop: o.handCrop },
            }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('fruitPressDeliver expects a card answer');
        const { tile, token, spend, handCrop } = answer.payload as {
          tile: string;
          token: number;
          spend: Partial<Record<Suit, number>>;
          handCrop?: Suit;
        };
        // The delivery answer names the CROP the hand card pays as; the
        // literal card is picked here, deterministically, so the answer
        // count stays additive (one per crop) rather than one per hand card.
        let handCard: CardId | undefined;
        if (handCrop !== undefined) {
          handCard = player(fx.state, task.pid).hand.find(
            (id) => cardById(fx.data, id).suit === handCrop,
          );
          if (handCard === undefined) {
            throw new Error(`No ${handCrop} card left in hand to pay The Fruit Press`);
          }
        }
        doDeliver(
          fx,
          task.pid,
          tile,
          spend,
          handCard === undefined ? { token } : { token, handCard },
        );
        return true;
      },
    },
  },
};

/**
 * O13 The Seed Bank - v48 retext (`tasks/v48-rulings-v2.md`, the builder-
 * default paragraph): "GROW 2 of your other buildings." (was "GROW 2 of your
 * other buildings, each with the top card of any deck.")
 *
 * Renamed from The Grand Orchard on 19/08/2026 (v30 group C) - the rename that
 * closed the D1 ruling in the file header.
 *
 * ⛔ THE DECK-PAID WILD GROW IS GONE. "Each with the top card of any deck" is
 * off the sheet, and the audit's resolved table reads the plain verb GROW
 * back the way it always means when nothing else is printed: one card from
 * hand, matching the target's activation cost (a wild activation takes any
 * card), placed on the stack, the ability fires. So `deckGrowOptions` is
 * swapped for `growOptions` and `doGrow`'s `fromDeck` mod is dropped for a
 * plain `payment` card - the same primitive an ordinary Grow move uses.
 * "Other buildings" needs no explicit exclusion of O13 itself: by the time
 * `activate` runs, `markFired` has already put O13 in `turn.firedThisTurn`
 * (every activation path marks fired before calling the handler), and
 * `growOptions` already drops anything in that list - the same reason a
 * Notice Board and an already-fired building never appear either. Because a
 * hand-paid Grow can fill and clog its target, unlike the old deck source,
 * the second Grow may find fewer legal targets than the first left behind.
 */
export const seedBank: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'TWO of your OTHER buildings, any tier and any suit, each a real hand-paid GROW - ' +
      'one matching card (or any card, for a wild activation) from hand, placed, the ' +
      'ability fires. One re-entrant task with `remaining` 2 and NO skip answer: mandatory, ' +
      'doing as much as it can (one legal target grows one; zero grows none; a hand with no ' +
      'matching card for either remaining target also grows none). Each step delegates ' +
      'straight to `growOptions(data, state, seat)` for its answer set (never O13 itself, ' +
      'never a Notice Board, never a full building, never a building already fired this ' +
      'turn, all read off `turn.firedThisTurn`) and `doGrow(..., building, payment)` to ' +
      "resolve it. The task re-queues itself AFTER the activation's own tasks (`pushTask` " +
      "appends), so the second building is chosen once the first one's ability (and any " +
      'cards it draws or places) has fully resolved.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'seedBankGrow',
      riders: { remaining: 2 },
    });
  },
  tasks: {
    seedBankGrow: {
      answers(data, state, task) {
        if ((task.riders.remaining as number) <= 0) return [];
        return growOptions(data, state, task.pid)
          .filter((o) => o.payment !== null)
          .map(
            (o) =>
              ({
                kind: 'grow',
                building: o.building,
                payment: o.payment,
              }) as TaskAnswer,
          );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'grow') throw new Error('seedBankGrow expects a grow answer');
        if (answer.payment === null) {
          throw new Error('seedBankGrow is always paid from hand');
        }
        doGrow(fx, task.pid, answer.building, answer.payment);
        const remaining = (task.riders.remaining as number) - 1;
        // Re-queued AFTER the activation's own tasks (pushTask appends), so the
        // second building is chosen once the first Grow's ability has resolved.
        if (remaining > 0) {
          fx.pushTask({
            t: 'card',
            pid: task.pid,
            src: task.src,
            kind: 'seedBankGrow',
            riders: { remaining },
          });
        }
        return true;
      },
    },
  },
};

/**
 * O14 The Conservatory - "SOW every card in your hand onto your buildings, then
 * Draw 4."
 */
export const conservatory: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ RULED AND RETEXTED (Dean, v32). The card read "then draw until your hand is ' +
      'full", which lost its referent when v31 deleted the hand limit and was the one ' +
      'printed line in the catalogue with no rule behind it; the engine had to pick a ' +
      'reading and refilled to `rules.setup.startingHand`. It now prints a flat DRAW 4. ' +
      '⚠️ THIS IS NOT THE SAME NUMBER, AND THE DIFFERENCE IS THE WHOLE RULING. A refill ' +
      'and a flat draw agree only when every card actually gets sown, because that empties ' +
      'the hand and "back up to 4" and "draw 4" land on the same total. THEY DIVERGE WHEN ' +
      'THE SOW CANNOT PLACE EVERYTHING - a farm whose buildings are full or clogged - where ' +
      'a refill drew fewer, one for each card the sow could not shift, and a flat draw ' +
      'draws four regardless. So THE CARD IS NOW STRONGEST IN EXACTLY THE POSITION WHERE ' +
      'IT USED TO BE WEAKEST: a clogged farm can no longer punish it, and a seat with ' +
      'nowhere at all to sow still takes four cards for one GROW. That is the case to ' +
      'watch, and orchard.test.ts pins it. ' +
      'The quantifier on the sow half is EVERY CARD IN YOUR HAND and nothing caps it. ' +
      'Mandatory while a placement exists (printed "SOW", not "you may"), so the answer set ' +
      'is placements alone; the single forced `skip` that follows is the draw, which cannot ' +
      'be inline because a task that offers nothing is dropped. ' +
      '⚠️ THE DRAW IS AN ORDINARY CARD-ABILITY DRAW NOW, not the old `autoDraw` refill. ' +
      'That is deliberate: the printed word is "Draw", so it goes through the see-N/keep-N ' +
      'task like every other Draw in the suit, the player picks the decks, and ' +
      '`afterDrawKeep` fires. The old refill used autoDraw specifically so it could never ' +
      'reach the divert seam, and that reason has gone twice over - a keep-everything draw ' +
      'discards nothing, and O17 moved off the draw discard entirely. ' +
      '⚠️ The card most likely to be over budget, at four placements plus four cards for ' +
      'one action; the dial the design names is the DRAW, not the sow, and it is now a ' +
      "printed number rather than an engine reading. ⚠️ Its mass SOW crosses into Apiary's " +
      "verb the way W11's Deliver crosses into Vegetable's - RULED YES on the same standard: " +
      "Apiary's identity is CROSS-TABLE sow, not sow as such. " +
      'RETIRED THE ACTION SEAM 19/08/2026: it was an ACTION card whose standing move was ' +
      'the main action, and it is now an ordinary GROW building (threshold 1, wild ' +
      'activation). Three consequences, all wanted. The GROW payment leaves the hand before ' +
      'the sow enumerates, so the card sows ONE FEWER card than it used to and the budget ' +
      'worry above is a little smaller. That payment fills O14 itself to its threshold of ' +
      '1, so O14 drops out of its own target list on the same activation - the sow is onto ' +
      'the REST of the farm, which is what the card is for. And the old `moves` gate ' +
      '(could it sow, or could it draw?) is gone: GROW is offered by the generic ' +
      'enumerator, and an activation that finds nothing to sow simply draws its four.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'sowAll', riders: {} });
  },
  tasks: {
    sowAll: {
      answers(data, state, task) {
        const p = player(state, task.pid);
        // `canSowOnto`, not `canTakeCard`: O14 SOWS, and a sow may never choose
        // a Notice Board under the notice-board visit (S11, 10/09/2026).
        const targets = p.tableau.filter((b) => canSowOnto(data, b));
        const out = p.hand.flatMap((card) =>
          targets.map((b) => ({ kind: 'card', payload: { card, onto: b.card } }) as TaskAnswer),
        );
        // Nothing left to sow: the one forced answer IS the draw. It is reached
        // either because the hand is empty (every card was sown) or because
        // nothing on the farm can take another card - and since v32 those two
        // routes pay the same four cards, which is the ruling.
        return out.length > 0 ? out : [{ kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') {
          // A FLAT FOUR, not a refill to four: the hand is not consulted. See
          // the notes - this is the half of the card the v32 ruling changed.
          drawN(fx, task.pid, task.src, CONSERVATORY_DRAW);
          return true;
        }
        if (answer.kind !== 'card') throw new Error('sowAll expects a card or skip answer');
        fx.placeOnBuilding(
          task.pid,
          { seat: task.pid, card: answer.payload.onto as CardId },
          answer.payload.card as CardId,
        );
        return false;
      },
    },
  },
};

/**
 * O15 The Garden Library - v48 retext (`tasks/v48-rulings-v2.md`, the
 * builder-default paragraph): "Draw until you have 6 cards in hand." (was
 * "Draw the top card of each deck, then give 1 card to a neighbour.")
 *
 * ⛔ NEITHER OLD HALF SURVIVES. No more one-card-per-deck reveal, no more
 * give: the hand is counted once, when `activate` runs (after the GROW
 * payment has already left it, as it has for every Grow), and if it holds
 * fewer than 6 the shortfall is a flat see-N/keep-N Draw - exactly `drawN`,
 * the same helper O4's naked Draw 3 uses - the owner choosing a deck for
 * each card as it is revealed. A hand already at 6 or more draws nothing
 * (`drawN`'s own `n <= 0` guard), and a table that runs dry mid-draw simply
 * keeps what it found (the `draw` task's own fallback), which is the
 * mandatory "as much as it can" reading with no code of its own needed for
 * it - never anybody else at the table.
 */
export const gardenLibrary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The quantifier is now a HAND FLOOR rather than a deck count, and it no longer ' +
      'self-balances across seat counts the old "one per live deck" reading did: it draws ' +
      'more from a small hand and nothing from a hand already at or above 6, whatever the ' +
      'seat count. A real Draw, through the ordinary see-N/keep-N task like every other ' +
      'card-ability Draw in the suit, so `afterDrawKeep` fires and a discard, if the funnel ' +
      'ever produced one, would still reach O17 - though a keep-everything draw never does.',
  },
  activate(fx, self) {
    const short = 6 - player(fx.state, self.seat).hand.length;
    drawN(fx, self.seat, self.card, short);
  },
};

/**
 * O16 The Fruit Store - "Whenever you visit a neighbour, Draw 1."
 *
 * Renamed from The Orchard Keeper on 19/08/2026 (v30 group C).
 */
export const fruitStore: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v42 (16/09/2026): TWO CHANGES. The once-per-turn guard is gone (Dean, ' +
      '15/09/2026: card text fires every time its trigger happens). And the draw is an ' +
      "ordinary Draw 1 with the player's choice of deck, as W16 and W17 draw, where it " +
      'was a choiceless own-suit autoDraw: the "DL-67" reason below was a v36 reading, and ' +
      'the v42 text says "Draw 1" like every other card. The paragraphs below that argue ' +
      'the guard and the autoDraw are history. ' +
      'THE MOST IMPORTANT SINGLE EDIT IN THE REBUILD, and it is a one-word guard flip: the ' +
      'card used to pay Orchard for BEING VISITED, on the suit whose entire measured ' +
      'advantage is being visited. It now pays for GOING OUT. Fires once per visit the ' +
      'owner MAKES, after the fee lands and before the door action runs. The draw is a ' +
      'choiceless own-suit-fallback autoDraw (DL-67): no picker, no divert seam, no ' +
      'recursion. Under D1 this card is not an ORCHARD, and since the v30 rename its name ' +
      'no longer claims to be one either. ' +
      '⚠️ IT NOW GUARDS ON `event.self` (v31), like A17 The Smoke Pot. Self-visiting is ' +
      'risk 2 of the whole pass, and a card that paid out on it would be paying its owner ' +
      'for the SOLITAIRE half of the bonus slot - the exact shape every previous edition of ' +
      'this game has had crowd the visit out. ' +
      '⛔ AND IT GAINED A PER-TURN GUARD ON 10/09/2026, WHICH IT HAD NEVER HAD. S9 makes A ' +
      "Helping Hand's second bonus a second PLACEMENT onto a different board, so this card " +
      'could fire twice in a turn for the first time; the standing rule of 11/08/2026 is ' +
      "that no card's text fires twice in a turn, so the omission is closed the way W17 The " +
      'Pie Shop already does it - the shared `turn.firedThisTurn` list through `markFired`.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.visitor !== self.seat) return;
      // "a NEIGHBOUR" - a self-visit is not one (v31). NEW GUARD, and it is a
      // rule the card's own text always carried: before v31 a visitor and a host
      // could not be the same seat, so the word did no work and needed no code.
      // Without it this card would draw on every bonus slot its owner ever
      // spends, with nobody else at the table involved at all.
      if (event.self) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/**
 * O17 The Fruit Basket - v48 retext (`tasks/v48-rulings-v2.md`, R12): "Once
 * per turn, if you have 6 or more cards in hand, put 1 card of your choice
 * from your hand into your Barn." (was "Once per turn, instead of discarding
 * a card you spend from your hand, put it into your barn.")
 *
 * ⛔ THE BUILD-PAYMENT DIVERT SEAM IS GONE. The card no longer listens to
 * `afterBuild` at all, so the whole `divertOrDiscard` / `stillDiscarded`
 * machinery it shared with D5 and D6 leaves with it: nothing here reaches
 * into a discard pile any more, and it no longer cares whether a spend came
 * from the hand or the barn (the A150 restriction that mattered under the
 * old wording has no subject either).
 *
 * ⭐ THE NEW HOOK IS `beforeTurnEnd` (fx.ts), the same seam O18 A Helping
 * Hand and V17 The Dockworker's Union already listen on: `finishTurn`
 * (turnflow.ts) fires it exactly once a turn, before the hand-limit discard,
 * which is what makes "once per turn" automatic here - unlike the old
 * build-payment card, there is no need for an explicit `markFired` guard,
 * because the hook itself only ever fires once. Owner-scoped
 * (`event.seat === self.seat`), and MANDATORY ("put", not "you may"): with a
 * hand of 6 or more the owner must send one chosen card to the barn, through
 * the ordinary `handToBarn` task (`remaining: 1`, no `optional` flag) W4,
 * V9 and V4 already use for a plain hand-to-barn placement. With a hand
 * under 6 the listener returns and nothing is offered at all.
 */
export const fruitBasket: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'The condition and the effect now talk about the same resource - a big hand feeds ' +
      'the barn - where the old card read the build payment instead. Checked once, at the ' +
      'fixed end-of-turn moment, so a hand that crosses 6 and back down again mid-turn is ' +
      'read only at the boundary; order against O18 and any other `beforeTurnEnd` listener ' +
      'falls under the rule book\'s general "the player whose turn it is chooses".',
  },
  on: {
    beforeTurnEnd(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (player(fx.state, self.seat).hand.length < 6) return;
      fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: 1 });
    },
  },
};

/** O19 The Fruit Hall - "Game end: 1 VP for every 3 cards in your hand." */
export const fruitHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⛔ REPLACED (v31, plan section 3.2). It read "1 VP for each EMPTY SPACE in your ' +
      'hand" and lost its referent when the hand limit went, so the mirror image is the ' +
      'honest replacement: it used to count DID YOU CONVERT and it now counts DID YOU ' +
      "ACCUMULATE, which states Orchard's identity - patient accumulation - directly. " +
      '⚠️ THE DIVISOR IS THE DIAL AND IT IS THE FIRST THING TO SWEEP (the plan says so). ' +
      '⭐ AT THE TABLE THERE IS NO HAND LIMIT, so the card is uncapped there. In the ENGINE ' +
      'the hand is bounded by `rules.turn.handLimit` (10 since 24/09/2026, was 7, an ' +
      'instrument bound and not a rule), which caps this card at 3 VP in simulation ' +
      '(was 2 VP at the bound of 7); any reading of it off the ' +
      'simulator is a reading about the instrument. It still scores on the ONE zone ' +
      'nothing forces a player to empty. ' +
      'It is also the exact inverse of what every other suit is doing at game end - ' +
      'everybody else is trying to get cards out of their hand and onto the island - which ' +
      'is both what makes it a real decision and what makes it dangerous. ' +
      '⚠️ It pairs with O21 The Harvest Festival, which counts the same resource in ' +
      "everybody ELSE'S hands, and since v39 at the same divisor of 3. A seat holding both " +
      'is paid for a table that never spends.',
  },
  gameEnd(_data, state, seat) {
    return Math.floor(player(state, seat).hand.length / 3);
  },
};

/**
 * O20 Crop Diversity - "Game end: 2 VP for each 2VP building you have built."
 * (v41; was "2 VP for each ORCHARD".)
 *
 * Renamed from The Orchard Archive on 19/08/2026 (v30 group C). The old worry
 * that the name said the opposite of the card (depth in one crop) has eased:
 * a 2VP building may be of any suit.
 */
export const cropDiversity: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v41: 2 VP for each building you have built whose PRINTED VP is exactly 2, of ' +
      'any suit (`builtBuildingsWorth`, buildings.ts). Buildings only, never a Power or ' +
      'Endgame card, never a starter. One of a family with A20 (1VP) and D21 (3VP). The ' +
      'ORCHARD count below is history. ' +
      'Counts THE DEPTH OF THE GROVE, and matches W21 The Bread Hall exactly. It counts ' +
      'ORCHARDs rather than barn cards on purpose: the barn is scored at game end and ' +
      'delivering empties it, so any barn-counting endgame card would pay you for holding ' +
      'freight back from the island. Caps at 10 under D1 (five Tier 1 cards, 2 VP each) - ' +
      'the whole reason D1 had to be ruled, since the title-keyword reading would once have ' +
      'counted itself, O16 and O13 for up to 16 against a winning score of 38. The v30 ' +
      'renames took all three names out of the keyword, so the cap is 10 by either reading ' +
      'now. ⚠️ It points the same way as the Barn rider and the printed 1 VP, so ' +
      '"build the whole grove" is now paid three times: a coherent build-around, and the ' +
      "suit's strongest single plan.",
  },
  gameEnd(data, state, seat) {
    return 2 * builtBuildingsWorth(data, state, seat, 2);
  },
};

/**
 * O21 The Harvest Festival - "Game end: 1 VP for every 3 cards in other
 * players' hands." (v39; the divisor was 2.)
 */
export const harvestFestival: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "Counts THE TABLE'S ABUNDANCE: floor(total rival hand cards / 3) - one pool across " +
      'all rivals, not per player. The one endgame card in the game that pays its owner for ' +
      'the state of everybody else, which is what makes it the natural partner of a suit ' +
      'that spends its turns handing cards across the table.',
  },
  gameEnd(_data, state, seat) {
    const total = state.players.reduce((sum, p, s) => (s === seat ? sum : sum + p.hand.length), 0);
    return Math.floor(total / 3);
  },
};
