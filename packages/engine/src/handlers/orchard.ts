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
 */

import type { GameData, Suit } from '@gp/data';

import { freeHandSpace, growOptions } from '../actions.js';
import type { GrowOption } from '../actions.js';
import type { Fx } from '../fx.js';
import { buildingOf, canTakeCard, cardById, drawableSuits, player } from '../query.js';
import { doGrow, markFired } from '../runtime.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { farmsteadHandler } from './farmstead.js';
import type { CardHandler, CustomTask } from './types.js';

/**
 * ORCHARD sub-type membership. See the closed D1 ruling in the file header: the
 * five TIER 1 cards and nothing else. Since the v30 renames that set is also
 * exactly the set of cards whose names contain the whole word "Orchard", so
 * this no longer contradicts the printed names - it is the same answer reached
 * by a route a rename cannot move. Four cards depend on this definition - O1's
 * build refund, O11's harvest loop, O13's grow loop and O20's endgame count -
 * and they must all read the same one.
 */
export function isOrchardCard(data: GameData, id: CardId): boolean {
  const card = cardById(data, id);
  return card.suit === 'orchard' && card.type === 'tier1';
}

/** The seat's built ORCHARDs, in tableau order. All five print a threshold. */
function ownOrchards(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isOrchardCard(data, b.card));
}

function builtOrchardCount(data: GameData, state: GameState, seat: Seat): number {
  return ownOrchards(data, state, seat).length;
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

/** Decks on the table with cards left - O15's "each deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

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
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour, and no printed text to have behaviour about. Registered so that a Barn ' +
      'with no entry reads as a deliberate blank rather than as a card nobody implemented.',
  },
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

/** O4 The Apple Orchard - "Draw 2." */
export const appleOrchard: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The naked skeleton at half price: every other ORCHARD is this plus one conversion. ' +
      'At cost 1 with the Barn refunding 2 it is the only card-POSITIVE build in the suit.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
  },
};

/** O5 The Pear Orchard - "Draw 2, then SOW 1 card from your hand onto this ORCHARD." */
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
 * O6 The Cherry Orchard - "Draw 2, then give 1 card to a neighbour and Draw 1."
 *
 * ⛔ The £1 is a Draw 1 (v31, plan section 3.3). The shape is untouched: the
 * payout still fires only when a card actually crosses the table, which is the
 * suit's standing rule that a payoff needs somebody else at the table.
 */
export const cherryOrchard: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Converts into A CARD BACK, and like every payout in the rebuilt suit it needs ' +
      'somebody else at the table. The Draw 2 resolves first, so the card given may be one ' +
      'just drawn. Mandatory as printed, auto-skipping on an empty hand or an empty table. ' +
      'The refund fires only when a card actually crosses. ' +
      '⚠️ THE CONVERSION MADE IT NEARLY FREE. Giving a card and taking £1 was a real ' +
      'trade at a table where seats ended on about £1; giving a card and drawing one is ' +
      'card-neutral, so the cross-table half now costs its owner nothing at all and the ' +
      'card is a plain Draw 2 with a rider that only ever helps. That is the shape the ' +
      'gift-aversion research says players like and the balance sheet should distrust.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'give', riders: {} });
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
        drawN(fx, task.pid, task.src, 1);
        return true;
      },
    },
  },
};

/** O7 The Golden Orchard - "Draw 2, then you may Harvest one of your ORCHARDs." */
export const goldenOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
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
      filter: 'loaded',
      targets: ownOrchards(fx.data, fx.state, self.seat).map((b) => b.card),
      optional: true,
      then: 'harvest',
    });
  },
};

/** O8 The Heritage Orchard - "Draw 2, then you may Build." */
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

/** O9 The Fruit Stand - "Give 1 card to each neighbour. Draw 2 for each." */
export const fruitStand: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The noun is CARDS YOU GIVE AWAY. Re-entrant: one card per answer, and "one each" is ' +
      'the clause that kills "is he getting more than me" - a seat that has already ' +
      'received drops out of the answer set for the rest of the activation. ⛔ DRAW 2 PER ' +
      'CARD, NEVER 1: at 1-for-1 the card is exactly worthless, and this has been written ' +
      'down three times and reverted twice. The task re-queues itself BEHIND its own Draw 2 ' +
      'so the replacement cards arrive before the next give is chosen. ' +
      'SIMPLIFIED 19/08/2026 (v30 group D): "any number ... one each" became "1 card to ' +
      'each neighbour", so the HOW MANY choice is gone and only the WHICH CARD choice is ' +
      'left. There is no skip answer any more - the give is mandatory, exactly one per ' +
      'neighbour - which is why the difficulty drops a point and `conditional` goes false. ' +
      'THE NO-OP IS SILENT SKIP (v30 §8.3, the one answer applied to every mandatory ' +
      'effect in the pass): with an empty hand, or fewer cards than neighbours, or every ' +
      'rival at their hand limit (DL-63), the task simply enumerates nothing and is ' +
      'dropped. You give as many as you can, you draw 2 for each one that crossed, and the ' +
      'activation is never refused.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'stand',
      riders: { given: [] },
    });
  },
  tasks: { stand: standTask() },
};

/**
 * The re-entrant give-one-each loop (O9). Split out so the riders' shape is
 * written once.
 *
 * No `skip` answer since 19/08/2026: the printed text is "Give 1 card to each
 * neighbour", not "you may", so the only choice left is WHICH card goes to
 * whom. The loop stops the way every mandatory Orchard task stops - by
 * enumerating nothing, which `drainTasks` drops - and that is also the silent
 * no-op for a hand too small to serve everybody.
 */
function standTask(): CustomTask {
  return {
    answers(data, state, task) {
      const already = (task.riders.given as Seat[]) ?? [];
      const seats = giftableSeats(data, state, task.pid, already);
      return player(state, task.pid).hand.flatMap((card) =>
        seats.map((to) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
      );
    },
    resolve(fx, task, answer) {
      if (answer.kind !== 'card') throw new Error('stand expects a card answer');
      const to = answer.payload.to as Seat;
      fx.giveCard(task.pid, to, answer.payload.card as CardId);
      drawN(fx, task.pid, task.src, 2);
      fx.pushTask({
        t: 'card',
        pid: task.pid,
        src: task.src,
        kind: 'stand',
        riders: { given: [...((task.riders.given as Seat[]) ?? []), to] },
      });
      return true;
    },
  };
}

/** O10 The Cider House - "SOW 1 card from your hand onto each of your ORCHARDs." */
export const ciderHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
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
    for (const b of ownOrchards(fx.data, fx.state, self.seat)) {
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
 * O11 The Harvest Market - "Harvest every ORCHARD, however many cards are on
 * it, then Draw 1 for each card harvested."
 */
export const harvestMarket: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The noun is CARDS ON YOUR ORCHARDS. BUFFED 19/08/2026 (v30 group E): "this ORCHARD" ' +
      'became "EVERY ORCHARD", which turns a self-emptying valve into the suit\'s payoff ' +
      'card - one action clears the whole grove and pays a card for every card cleared. ' +
      'W12 Crop Rotation is the exact precedent in Wheat, down to snapshotting the ' +
      'qualifying set before harvesting any of it. ⛔ READING - IT NO LONGER HARVESTS ' +
      'ITSELF, and this is a real behaviour change, not a tidy-up. Under D1 an ORCHARD is ' +
      'O4-O8, and O11 is a Tier 2, so "every ORCHARD" does not reach it; W12 answers the ' +
      'identical question the identical way (W12 is not a Field, so Crop Rotation never ' +
      'harvests itself). The old text said "this ORCHARD" of a card that was never an ' +
      'ORCHARD, so the new text is the more honest of the two - but the consequence is ' +
      'that the GROW payment, which used to be harvested straight back off this card, now ' +
      'STAYS on O11 and counts toward its threshold of 2. "However many cards are on it" ' +
      'is still the printed exception to the full gate, so each harvest is fx.harvest ' +
      'directly rather than the action. Empty ORCHARDs are skipped rather than harvested ' +
      'for nothing, so no listener sees a harvest of zero cards. Against O7: Golden ' +
      'harvests ONE ORCHARD and draws nothing; the Market harvests ALL of them and draws ' +
      'per card. ⚠️ Watch-list: this is now plausibly above the Tier 2 budget beside O10 ' +
      'The Cider House, which fills every ORCHARD for one action - fill the grove, then ' +
      'empty it, is a two-card loop that pays cards both ways.',
  },
  activate(fx, self) {
    // Snapshot first (W12's shape): harvesting mutates the tableau, and the
    // draw is one lump for the whole loop rather than one task per building.
    const targets = ownOrchards(fx.data, fx.state, self.seat)
      .filter((b) => b.stack.length > 0)
      .map((b) => b.card);
    let harvested = 0;
    for (const card of targets) {
      harvested += buildingOf(fx.state, self.seat, card).stack.length;
      fx.harvest(self.seat, card);
    }
    drawN(fx, self.seat, self.card, harvested);
  },
};

/** O12 The Fruit Press - "Put any number of cards from your hand into your barn." */
export const fruitPress: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The noun is CARDS IN YOUR HAND, and one of only three routes this suit has to the ' +
      "barn (the others being O7's harvest and O17's build-payment divert, which since v31 " +
      'reaches build payments alone rather than every discard) - Orchard is rich in cards ' +
      'and deliberately poor in freight. Re-entrant handToBarn, optional so any number ' +
      'means any number including none. ⚠️ Overlaps W10 The Furrow at the same tier and ' +
      'price and is the BETTER card, being chosen and partial where the Furrow is total and ' +
      "mandatory. One of the two should move; that is a Wheat edit and Dean's call, so " +
      'both are in the arm as printed and they will compete in it.',
  },
  activate(fx, self) {
    const n = player(fx.state, self.seat).hand.length;
    if (n === 0) return;
    fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: n, optional: true });
  },
};

/** The ORCHARDs O13 could still grow: the plain Grow enumerator, narrowed. */
function seedBankGrowOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  done: readonly CardId[],
): GrowOption[] {
  return growOptions(data, state, seat).filter(
    (o) => isOrchardCard(data, o.building) && !done.includes(o.building),
  );
}

/**
 * O13 The Seed Bank - "GROW each of your ORCHARDs."
 *
 * Renamed from The Grand Orchard on 19/08/2026 (v30 group C) - the rename that
 * closed the D1 ruling in the file header.
 */
export const seedBank: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: true },
    notes:
      'The hard one, and the card that attacks the measured problem in the whole game: GROW ' +
      'happens about 3.6 times per player per game and fires the printed ability on 58 of ' +
      '105 cards, so this buys the TRIGGER in bulk instead of inflating a payload. Each ' +
      'step is a REAL grow through doGrow - a matching card paid onto the stack, the ' +
      "surcharge, the ability, the Apiary Farmstead's rider - so nothing about a GROW is " +
      "re-implemented here. The loop re-queues itself BEHIND each activation's own tasks, " +
      'which is what makes the old printed "in turn" true: the order is the player\'s and ' +
      "it matters (O7's harvest and O8's build both want to come after the draws that fund " +
      'them). Full ORCHARDs, unaffordable ones and ones already grown this activation all ' +
      'drop out of the answer set, so it can never grow one twice and never grows ITSELF ' +
      '(a Tier 3 card is not an ORCHARD under D1, and doGrow marks it fired before activate ' +
      'runs in any case). Capped by the hand, not the tableau: four ORCHARDs need four ' +
      'orchard cards out of 4. ' +
      '⛔ READING - "EACH" IS UNBOUNDED AND THE PAY-AS-YOU-GO SURVIVED THE SHORTENING. The ' +
      'v30 text drops "in turn, paying each cost as you go. Skip any you cannot or do not ' +
      'want to pay", which is a shortening of the printed line and NOT a removal of the ' +
      'payment: Dean ruled "each" correct (unbounded, not the fix list\'s cap of 3), and ' +
      'every step is still a real GROW that costs a real matching card, so the skip answer ' +
      'stays as the way to decline one you can pay for but do not want. ' +
      'RETIRED THE ACTION SEAM 19/08/2026: this was an ACTION card whose standing move was ' +
      'the main action. It is now an ordinary GROW building (threshold 1, wild activation), ' +
      'so the GROW that fires it is itself the action and the payment card lands on O13 ' +
      'before the loop starts - one more card out of the hand that funds the loop, which ' +
      'is the real cost of the conversion and the reason the difficulty drops from 5 to 4.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'seedBankGrow',
      riders: { done: [] },
    });
  },
  tasks: {
    seedBankGrow: {
      answers(data, state, task) {
        const done = (task.riders.done as CardId[]) ?? [];
        // R15: a step of the loop may be paid with a meeple, in which case
        // `payment` is null and `meeples` carries it. Both ride in the payload
        // so `resolve` can hand `doGrow` exactly what the enumerator offered.
        const out = seedBankGrowOptions(data, state, task.pid, done).map(
          (o) =>
            ({
              kind: 'card',
              payload: {
                building: o.building,
                payment: o.payment,
                ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
              },
            }) as TaskAnswer,
        );
        if (out.length === 0) return [];
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('seedBankGrow expects a card answer');
        const building = answer.payload.building as CardId;
        doGrow(
          fx,
          task.pid,
          building,
          answer.payload.payment as CardId | null,
          {},
          (answer.payload.meeples as Suit[] | undefined) ?? [],
        );
        // Re-queued AFTER the activation's own tasks (pushTask appends), so the
        // cards a grow draws are in hand before the next one is chosen.
        fx.pushTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'seedBankGrow',
          riders: { done: [...((task.riders.done as CardId[]) ?? []), building] },
        });
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
        const targets = p.tableau.filter((b) => canTakeCard(data, b));
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
 * O15 The Garden Library - "Draw the top card of each deck. You may give a card
 * to every other player and Draw 1 per card given."
 */
export const gardenLibrary: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The quantifier is THE TOP CARD OF EACH DECK, and its best property is that it ' +
      'self-balances across seat counts, which nothing else in the game does: two seats ' +
      'keep four and take £1, three keep three and take £2, four keep two and take £3. ' +
      '⛔ THIS IS NOT A DRAW however it is printed, and that is deliberate. It must not ' +
      'consult withDrawModifier, must not fire afterDrawKeep and must not reach the divert ' +
      'seam - so it is takeDeckTop into limbo, then passCard / cardsToHand, none of which ' +
      'touch the draw funnel. "Draw" in this game means cards into your hand from decks of ' +
      'YOUR choosing; the top card of EACH deck is a fixed reveal and triggers nothing. ' +
      '⚠️ THE v30 SHEET PRINTS "Draw the top card of each deck" WHERE IT USED TO PRINT ' +
      '"Take". The implementation deliberately did not follow the verb - the v30 plan says ' +
      'the rewrite "keeps its shape" and only makes the give optional - but a table will ' +
      'read "Draw" and expect the Orchard Farmstead modifier and the divert seam to fire on ' +
      'it, which would gift away the cards this card just took. A RULING IS OWED: either ' +
      'the sheet goes back to "Take", or somebody accepts a genuinely different card. ' +
      'The refund fires per card that actually crosses. ⚠️ ITS SELF-BALANCING PROPERTY IS ' +
      'GONE WITH THE COIN, and that was its best one: two seats kept four cards and took ' +
      '£1, four seats kept two and took £3, so the card was worth about the same at every ' +
      'seat count. Paying a CARD per gift makes it exactly neutral instead - give one, draw ' +
      'one - so the card is now "keep the top of every deck" at every seat count and the ' +
      'give is free flavour. Re-read the give rate if the card runs hot. ⚠️ Deck-top ' +
      'pressure: this is the first card to cut if reshuffles per played deck climb. ' +
      'v30 (19/08/2026) made two changes here. The give became OPTIONAL ("you may"), so ' +
      'the skip answer - keep everything, mint nothing - is offered at EVERY step and not ' +
      'only once the rivals run out; a seat that wants the cards more than the coins may ' +
      'now say so, and a seat may serve one rival and stop. And the ACTION seam is retired: ' +
      'it is an ordinary GROW building (threshold 2, wild activation), so the GROW is the ' +
      'action and the payment card lands on O15 before the decks are touched.',
  },
  activate(fx, self) {
    const taken: CardId[] = [];
    for (const suit of liveDecks(fx.data, fx.state)) {
      const card = fx.takeDeckTop(suit);
      if (card !== null) taken.push(card);
    }
    if (taken.length === 0) return;
    // A STANDARD DRAW (Dean, 19/08/2026): the sheet says "Draw the top card of
    // each deck", and Dean ruled the word literal - normal draw rules apply.
    //
    // So it goes through the DRAW TASK rather than arriving by `cardsToHand`.
    // `revealed` is pre-filled because the CARD names the decks, not the
    // player, and see === keep because the card keeps everything it draws; the
    // task then has exactly one legal answer and resolves straight through to
    // the funnel. What that buys is the seam, not a number: `afterDrawKeep`
    // fires and the unkept remainder (here always empty) goes through
    // `discardOrDivert`, exactly as a base Draw or a Draw Service does.
    //
    // ⚠️ It changes nothing observable TODAY, and that is worth writing down so
    // nobody "simplifies" it back. Nothing in the catalogue listens to
    // `afterDrawKeep` yet, and O17 The Fruit Basket cannot reach it for two
    // independent reasons since v31 - a draw that keeps everything discards
    // nothing, and O17 is not on the discard seam at all any more. The next card
    // that keys off drawing will see this one; the old `takeDeckTop`-into-limbo
    // shape would have been invisible to it.
    fx.pushTask({
      t: 'draw',
      pid: self.seat,
      src: self.card,
      see: taken.length,
      keep: taken.length,
      revealed: taken,
    });
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'library',
      riders: { cards: taken, given: [] },
    });
  },
  tasks: {
    library: {
      answers(data, state, task) {
        const cards = (task.riders.cards as CardId[]) ?? [];
        if (cards.length === 0) return [];
        const seats = giftableSeats(data, state, task.pid, (task.riders.given as Seat[]) ?? []);
        const out = seats.flatMap((to) =>
          cards.map((card) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
        );
        // Skip = keep the rest and mint nothing. Offered at EVERY step since the
        // v30 "you may", not only when the rivals have run out - it is the whole
        // of what the optional wording buys.
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        const cards = (task.riders.cards as CardId[]) ?? [];
        if (answer.kind === 'skip') {
          // Nothing to move: the draw above already put every card in hand.
          task.riders.cards = [];
          return true;
        }
        if (answer.kind !== 'card') throw new Error('library expects a card or skip answer');
        const card = answer.payload.card as CardId;
        const to = answer.payload.to as Seat;
        // `giveCard` and not `passCard` since the draw landed them in hand:
        // the card leaves a real hand, so `fromHand` tells a bot the giver is
        // genuinely a card down. `passCard` is the divert seam's move, for a
        // card that never reached a hand at all.
        fx.giveCard(task.pid, to, card);
        // "Draw 1 per card given", paid one at a time as each gift lands. The
        // draw task is APPENDED, so it resolves after the whole library task has
        // finished handing cards out - a replacement card can therefore never be
        // given away by the same activation that drew it.
        drawN(fx, task.pid, task.src, 1);
        task.riders.cards = cards.filter((c) => c !== card);
        task.riders.given = [...((task.riders.given as Seat[]) ?? []), to];
        return (task.riders.cards as CardId[]).length === 0;
      },
    },
  },
};

/**
 * O16 The Fruit Store - "Whenever you VISIT a neighbour, Draw 1."
 *
 * Renamed from The Orchard Keeper on 19/08/2026 (v30 group C).
 */
export const fruitStore: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
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
      'this game has had crowd the visit out.',
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
      fx.autoDraw(self.seat, 1);
    },
  },
};

/**
 * O17 The Fruit Basket - "Once per turn, instead of discarding a card you spend,
 * put it into your barn."
 *
 * ⭐ THE CAP IS THE v32 RULING, AND DEAN TOOK IT INSTEAD OF A PRICE. v31 moved
 * the card off the draw discard onto the build payment and deleted its £1, which
 * left it free, mandatory in effect and taken every single time: a card in your
 * barn is delivery fuel where a card in the discard is nothing, so "you may" was
 * a prompt with one sensible answer. The plan named the alternative price
 * ("discard a card from your hand", the only currency left); the ruling is a
 * ONCE-PER-TURN LIMIT instead.
 *
 * ⛔ AND "YOU MAY" IS GONE WITH IT, DELIBERATELY. The decision the card now asks
 * is WHICH spent card and ON WHICH BUILD, not whether - so the task offers no
 * skip. "Which build" is a real question because a turn can hold more than one:
 * D12 The Butter Factory builds two, D10 and D15 grant builds, and the Dairy
 * door is a Build alongside your own main action. The cap goes to the FIRST
 * build of the turn, so the way to spend it on a later one is to take that build
 * first - the choice is expressed in build ORDER rather than in a decline.
 *
 * ⚠️ THE ONE ARGUMENT AGAINST THE MANDATORY READING, recorded here so it is not
 * rediscovered: A CARD SENT TO THE BARN LEAVES THE SHARED DECK PERMANENTLY,
 * where a discarded card comes back on the natural reshuffle. So a mandatory
 * diversion is a small permanent drain on that suit's deck, every turn its owner
 * builds. Almost certainly a non-issue at this scale, and arguably a feature
 * given Orchard's identity is patient accumulation - but IF IT EVER BITES, THE
 * FIX IS TO RESTORE THE OPTION, NOT TO CHANGE THE CAP.
 *
 * ⛔ WHAT IT USED TO BE. Before v31 it read "Instead of discarding a card, you
 * may pay £1 to put it into your barn" and was one declaration and no code: the
 * `divertsDiscard` flag put it on the shared DISCARD funnel (`discardOrDivert`,
 * tasks.ts), where every discard reached it, the end-of-turn overflow included.
 * "A card you SPEND" is a strictly narrower moment and a different funnel - a
 * card thrown away by a see-N/keep-K draw is not spent, a card that pays for a
 * Build is - so the flag came off and the card listens to its own builds.
 *
 * ⚠️ WHERE IT HOOKS, AND WHY IT IS NOT `divertOrDiscard` ITSELF.
 * `divertOrDiscard` (actions.ts) is the build payment's one funnel and is
 * exported as the seam this card wants, but it runs INSIDE `doBuild` with no
 * wiring point a handler can reach, so this handler takes the next moment after
 * it: `afterBuild`, with the payment already face up in the discard, and
 * `fx.reclaimDiscard` to lift a card back out. That is the same route D5 The
 * Churning Shed and D6 The Trading Shed already take to reach the cards a build
 * spent, and `stillDiscarded` is the shared idea that keeps the three honest - a
 * card another effect has already claimed is no longer in the pile.
 *
 * ⭐ THE TASK IS PREPENDED, which is the ordering rule `divertOrDiscard`'s own
 * docblock states: a diversion is taken out FIRST, so the pile only ever holds
 * what nobody else claimed, and ONE DESTINATION PER SPENT CARD falls out of the
 * ordering instead of being asserted three times. Without the prepend a seat
 * holding both O17 and D6 would resolve them in tableau order, which is not a
 * rule anybody could read off the cards.
 */
export const fruitBasket: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'ONCE PER TURN, on the shared `turn.firedThisTurn` guard through `markFired` ' +
      '(runtime.ts, THE ONE WRITER of that list) - the same seam W16 The Granary was moved ' +
      'onto by the 2026-08-12 rebalance, and not a private counter. ✅ Safe for a Power ' +
      'card, CHECKED not assumed: `growOptions` and `activateTargets` filter on that list ' +
      'but also require `activationType !== null`, and O17 has none; both sow-target ' +
      'filters read it too, and O17 prints no threshold, so it was never a legal target to ' +
      'remove in the first place. ' +
      'The guard is checked AND set in the HOOK rather than at resolution, which is the ' +
      'pattern the retired W2 rider used: the payment is verified non-empty first, and ' +
      '`divertOrDiscard` has already put those cards face up in the discard by the time ' +
      '`afterBuild` fires, so a task that burns the cap and then finds nothing is not a ' +
      'reachable state. ' +
      '⚠️ ITS SCOPE SHRANK TWICE. It used to reach EVERY discard, which is why the ' +
      'watch-list called it "a rich Orchard turns every discard into freight"; v31 narrowed ' +
      'it to build payments, and v32 caps it at one card a turn. Its owner is an Orchard ' +
      'seat, which is not the suit that builds most, so expect it to fire once a turn at ' +
      'the very best. ' +
      'Deliberately NOT reached, and unchanged: barn spends. Paying the island is a spend ' +
      'in the plain-English sense, and buying a just-spent delivery card back would stop ' +
      'the barn being a dead end - the one rule that keeps freight from accelerating an ' +
      'engine. Cards D7 lifts off a stack are not reached either: they are spent, but they ' +
      'never go through the payment funnel this listens to.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      // ONCE PER TURN (v32). Checked and marked here, before the task is queued,
      // so a second build in the same turn never even opens a prompt.
      if (fx.state.turn.firedThisTurn.includes(self.card)) return;
      markFired(fx, self.card);
      fx.prependTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'basket',
        riders: { spent: [...event.payment] },
      });
    },
  },
  tasks: {
    basket: {
      answers(data, state, task) {
        const spent = stillDiscarded(data, state, (task.riders.spent as CardId[]) ?? []);
        // NO SKIP: the card prints "put", not "you may" (v32). With nothing left
        // in the pile the list is empty and the drain loop drops the task, which
        // is the same silent no-op a skip would have produced.
        return spent.map((card) => ({ kind: 'card', payload: { card } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('basket expects a card answer');
        // The card is already in its suit's discard: `divertOrDiscard` put it
        // there when the build paid. Lifting it back out is one primitive, and
        // it emits `discardToBarn`, so the freight metrics see it.
        fx.reclaimDiscard(task.pid, answer.payload.card as CardId);
        // ONE card, and done. It was re-entrant until v32, walking the whole
        // payment; the cap is a card a TURN, not a card a build.
        return true;
      },
    },
  },
};

/**
 * The payment cards still face up in their suits' discards - O17's live target
 * set.
 *
 * The same helper dairy.ts writes for D5 and D6, duplicated here rather than
 * shared across suit files on purpose: it is two lines, and a cross-suit import
 * between two card files is a coupling neither suit asked for. The RULE it
 * encodes is the shared thing, and it lives in `divertOrDiscard`'s docblock:
 * only the face-up cards this build discarded, no reaching into the pile's
 * history, and no reaching for one another effect has already claimed.
 */
function stillDiscarded(data: GameData, state: GameState, spent: readonly CardId[]): CardId[] {
  return spent.filter((id) => state.discards[cardById(data, id).suit]?.includes(id) === true);
}

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
      '⭐ RE-READ IT AGAINST THE HAND LIMIT, back at a flat 12 since 02/09/2026: this card ' +
      'is now CAPPED AT 4 VP, because 12 cards is the most a seat can be holding when the ' +
      'game is scored. That is a different card from the uncapped one v31 wrote, and the ' +
      'divisor should be swept WITH rules.turn.handLimit rather than against it - the two ' +
      'numbers set the ceiling together. It still scores on the ONE zone nothing forces a ' +
      'player to empty. ' +
      'It is also the exact inverse of what every other suit is doing at game end - ' +
      'everybody else is trying to get cards out of their hand and onto the island - which ' +
      'is both what makes it a real decision and what makes it dangerous. ' +
      '⚠️ It pairs with O21 The Harvest Festival, which counts the same resource in ' +
      "everybody ELSE'S hands at a divisor of 2. A seat holding both is paid for a table " +
      'that never spends, and 3-versus-2 is the only thing separating the two cards.',
  },
  gameEnd(_data, state, seat) {
    return Math.floor(player(state, seat).hand.length / 3);
  },
};

/**
 * O20 Crop Diversity - "Game end: 2 VP for each ORCHARD you have built."
 *
 * Renamed from The Orchard Archive on 19/08/2026 (v30 group C). ⚠️ The new name
 * says the opposite of what the card does - it pays for DEPTH in one crop, not
 * for diversity - which is an art-and-theme question, not an engine one, but it
 * is worth Dean seeing written down before the art is commissioned.
 */
export const cropDiversity: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
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
    return 2 * builtOrchardCount(data, state, seat);
  },
};

/** O21 The Harvest Festival - "Game end: 1 VP for every 2 cards in other players' hands." */
export const harvestFestival: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "Counts THE TABLE'S ABUNDANCE: floor(total rival hand cards / 2) - one pool across " +
      'all rivals, not per player. The one endgame card in the game that pays its owner for ' +
      'the state of everybody else, which is what makes it the natural partner of a suit ' +
      'that spends its turns handing cards across the table.',
  },
  gameEnd(_data, state, seat) {
    const total = state.players.reduce((sum, p, s) => (s === seat ? sum : sum + p.hand.length), 0);
    return Math.floor(total / 2);
  },
};
