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
 *      into the barn for £1. This file contributes the O17 half as a one-line
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

import { freeHandSpace, growOptions, handLimitOf } from '../actions.js';
import type { Fx } from '../fx.js';
import { buildingOf, canTakeCard, cardById, drawableSuits, player } from '../query.js';
import { doGrow } from '../runtime.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
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

/** Decks on the table with cards left - O15's "each deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/** Rivals who could physically accept a gift right now (DL-63). */
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
 * O1 Barn (starter) - "Hand size 4. When you build an ORCHARD, Draw 2." /
 * upgraded "Hand size 7. When you build an ORCHARD, Draw 2."
 */
export const orchardBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'W1 with one word changed, and the same three readings. The printed hand size is ' +
      'engine-read (handLimitOf off the current face). The rider is on BOTH faces ' +
      'deliberately: without it, paying £2 to upgrade would DELETE the power. It fires on ' +
      "any build path - the action, a Service, O8's granted build - because afterBuild is " +
      'the one funnel every landing goes through. A card-ability draw, so the Farmstead ' +
      'modifier does not apply (DL-47). It is what makes a 2-cost ORCHARD card-neutral to ' +
      'build and the 1-cost Apple card-POSITIVE, so the card tax the design doc claimed is ' +
      'now a tax on ASSEMBLY (holding two orchard cards at once out of a hand of 4), never ' +
      'on total cards. The Barn cannot refund a BUILD ACTION, which is why O8 is the most ' +
      'important Tier 1 in the suit.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (!isOrchardCard(fx.data, event.card)) return;
      drawN(fx, self.seat, self.card, 2);
    },
  },
};

/**
 * O2 Farmstead (starter) - "Your Draw is Draw 3, discard 1. Give the discarded
 * card to a neighbour." / upgraded "... and take £1 from the bank."
 */
export const orchardFarmstead: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in two engine seams, not this entry. (1) withDrawModifier (query.ts) ' +
      'is the numbers half: see +1 AND keep +1, now on BOTH faces, which reproduces the ' +
      'printed "Draw 3, discard 1" on the base action ((2,1)->(3,2)) and composes with the ' +
      'Draw Service ((2,2)->(3,3)). (2) drawGiftPower + the `divert` task (tasks.ts) are the ' +
      'discard half. THE WORDING SCOPES ITSELF and that is why there is no exception list: ' +
      'a Draw 2 with keep 2 has no discard, so there is nothing to give; card-ability draws ' +
      'bypass the modifier under DL-47; and the end-of-turn discard is not a draw, which ' +
      'closes the four-cards-for-£4 exploit with no special case at all. The base face is ' +
      'now strictly stronger than it was (keep 2 from turn 1), which is exactly why the ' +
      'upgrade had to stop being a bigger number. ⚠️ The upgraded £1 is the number the ' +
      'design flags as most likely wrong, at roughly £8-10 a game where seats currently end ' +
      'with £1 - overlays/orchard-farmstead-coin.overlay.json is the knob that zeroes it.',
  },
};

/** O3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const orchardNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs (coin, ' +
      "Service, the upgraded face's 2-cards-take-£3 mode) and the wage minting - is " +
      'engine-level.',
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
 * O6 The Cherry Orchard - "Draw 2, then give 1 card to a neighbour and take
 * £1."
 *
 * v30 trimmed the wording only ("from your hand", "from the bank"): the card
 * has always given a hand card and always minted from the bank, so there is no
 * code change here and none was intended.
 */
export const cherryOrchard: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Converts into COINS, and like every £ in the rebuilt suit it needs somebody else at ' +
      'the table - the coin rule the design sets itself. The draw resolves first, so the ' +
      'card given may be one just drawn. Mandatory as printed, auto-skipping when no ' +
      'neighbour has free hand space (DL-63: a gift never forces an out-of-turn discard) or ' +
      'the hand is empty. The £1 mints only when the card actually crosses.',
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
        fx.gainCoins(task.pid, 1, 'O6');
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
      "barn (the others being O7's harvest and O17's £1 divert) - Orchard is rich in cards " +
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
): { building: CardId; payment: CardId }[] {
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
        const out = seedBankGrowOptions(data, state, task.pid, done).map(
          (o) =>
            ({ kind: 'card', payload: { building: o.building, payment: o.payment } }) as TaskAnswer,
        );
        if (out.length === 0) return [];
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('seedBankGrow expects a card answer');
        const building = answer.payload.building as CardId;
        doGrow(fx, task.pid, building, answer.payload.payment as CardId);
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
 * draw until your hand is full."
 */
export const conservatory: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The quantifier is EVERY CARD IN YOUR HAND, and the hand size of 4 is the only thing ' +
      'capping it. Mandatory while a placement exists (printed "SOW", not "you may"), so ' +
      'the answer set is placements alone; the single forced `skip` that follows is the ' +
      'refill, which cannot be inline because a task that offers nothing is dropped. The ' +
      'refill is a card-ability draw - autoDraw, which by construction never fires ' +
      'afterDrawKeep and so never reaches the divert seam. ⚠️ The card most likely to be ' +
      'over budget at four placements plus a full refill for one action; the dial the ' +
      "design names is the REFILL, not the sow. ⚠️ Its mass SOW crosses into Apiary's verb " +
      "the way W11's Deliver crosses into Vegetable's - RULED YES on the same standard: " +
      "Apiary's identity is CROSS-TABLE sow, not sow as such. " +
      'RETIRED THE ACTION SEAM 19/08/2026: it was an ACTION card whose standing move was ' +
      'the main action, and it is now an ordinary GROW building (threshold 1, wild ' +
      'activation). Three consequences, all wanted. The GROW payment leaves the hand before ' +
      'the sow enumerates, so the card sows ONE FEWER card than it used to and the budget ' +
      'worry above is a little smaller. That payment fills O14 itself to its threshold of ' +
      '1, so O14 drops out of its own target list on the same activation - the sow is onto ' +
      'the REST of the farm, which is what the card is for. And the old `moves` gate ' +
      '(could it sow, or could it refill?) is gone: GROW is offered by the generic ' +
      'enumerator, and an activation that finds nothing to sow simply refills.',
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
        // Nothing left to sow: the one forced answer IS the refill.
        return out.length > 0 ? out : [{ kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') {
          const limit = handLimitOf(fx.data, fx.state, task.pid);
          const room = limit === null ? 0 : limit - player(fx.state, task.pid).hand.length;
          fx.autoDraw(task.pid, Math.max(0, room));
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
 * to every other player and gain £1 per card given."
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
      'The £1 mints per card that actually crosses. A rival at their hand limit cannot ' +
      'receive (DL-63) and simply drops out, taking their £1 with them. ⚠️ Deck-top ' +
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
          fx.cardsToHand(task.pid, cards);
          task.riders.cards = [];
          return true;
        }
        if (answer.kind !== 'card') throw new Error('library expects a card or skip answer');
        const card = answer.payload.card as CardId;
        const to = answer.payload.to as Seat;
        fx.passCard(task.pid, to, card);
        fx.gainCoins(task.pid, 1, 'O15');
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
      'advantage is being visited. It now pays for GOING OUT. Fires on any visit the owner ' +
      'MAKES - coin, Service or the 2-card Special Orders mode - once per visit, after the ' +
      'fee lands and before the payoff. The draw is a choiceless own-suit-fallback autoDraw ' +
      '(DL-67): no picker, no divert seam, no recursion. A Helping Hand repeat is not a ' +
      'visit and never fires it. Under D1 this card is not an ORCHARD, and since the v30 ' +
      'rename its name no longer claims to be one either.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.visitor !== self.seat) return;
      fx.autoDraw(self.seat, 1);
    },
  },
};

/**
 * O17 The Fruit Basket - "Instead of discarding a card, you may pay £1 to put
 * it into your barn."
 *
 * ⚠️ v30 re-worded this from "Whenever you discard a card, you may pay £1 to
 * put it into your barn instead", and the v30 plan rules explicitly that the
 * rewording does NOT move the seam: it is the same moment, the same funnel and
 * the same one-line declaration. "Instead of discarding" reads more naturally
 * at a table but scopes identically - every discard, including the end-of-turn
 * overflow, and never a barn spend.
 */
export const fruitBasket: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'One declaration and no code: the behaviour is the shared DIVERT SEAM (tasks.ts, the ' +
      '`divert` task), which it shares with the rebuilt Farmstead because both act on the ' +
      'same moment and are mutually exclusive per card by construction - a discard either ' +
      'crosses the fence for +£1 or goes in your barn for -£1, a £2 swing on every Draw ' +
      'with no new rule. Scoped at the discard funnel rather than at the draw, which is ' +
      'what its text says and which is why it also reaches the END-OF-TURN overflow. ' +
      'Deliberately NOT reached: barn spends, because paying the island is a spend and ' +
      'buying a just-spent delivery card back would stop the barn being a dead end. THE ' +
      'ONCE-PER-TURN CAP IS GONE - the wallet is the cap. ⚠️ A rich Orchard turns every ' +
      'discard into freight and freight is 80% of a winning score; this is the uncapped ' +
      'card the watch-list names.',
  },
  divertsDiscard: true,
};

/** O19 The Fruit Hall - "Game end: 1 VP for each empty space in your hand." */
export const fruitHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Counts DID YOU CONVERT - the suit whose whole thesis is cards through your hands ' +
      'rather than cards in it, scored. Empty spaces = the hand limit on the current Barn ' +
      'face minus the hand, floored at 0. THE CAP IS THE HAND LIMIT, not a printed number: ' +
      'the old "(max 4)" is gone, so an upgraded Barn raises the ceiling to 7 and the card ' +
      'asks a harder question of the seat that bought the bigger hand.',
  },
  gameEnd(data, state, seat) {
    const limit = handLimitOf(data, state, seat);
    if (limit === null) return 0;
    return Math.max(0, limit - player(state, seat).hand.length);
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
