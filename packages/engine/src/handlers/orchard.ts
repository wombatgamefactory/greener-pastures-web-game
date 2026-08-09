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
 * GOING OUT instead of for being visited, no Tier 1 reaches the barn any more,
 * and the three Tier 3 cards became ACTIONs so they fire at all.
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
 *   3. **Tier 3 prints an ACTION**, exactly as Wheat's does - shared helpers in
 *      `actionCard.ts`. O13 is the re-entrant one: it performs a REAL GROW on
 *      each of the owner's ORCHARDs in turn, paying each cost as it goes, and
 *      re-queues itself behind each activation's own tasks so the order is the
 *      player's and the draws land before the next choice.
 *
 * ⛔ **RULING OWED, IMPLEMENTED AS OPTION B** (handoff §3, D1). Every other
 * suit derives its sub-type from a whole-word title keyword (FIELD, HIVE,
 * DEPOT - reference DL-42). Orchard's names do not cooperate: The Grand
 * Orchard, The Orchard Keeper and The Orchard Archive all carry the word and
 * none of them is one, which would have O13 trying to grow itself and O20
 * paying up to 16 VP against a winning score of 38. So ORCHARD is defined here
 * as the suit's TIER 1 cards - O4 to O8 - and nothing else. That contradicts
 * the printed names, which is a teach failure at a table, and the honest fix is
 * to RENAME those three cards (option A) in a deliberate re-theme pass with
 * their art. This option is the one that is cheap and reversible, so the arm
 * can run; it is not the one that ships.
 */

import type { GameData, Suit } from '@gp/data';

import { freeHandSpace, growOptions, handLimitOf } from '../actions.js';
import type { Fx } from '../fx.js';
import { buildingOf, canTakeCard, cardById, drawableSuits, player } from '../query.js';
import { doGrow } from '../runtime.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { actionMove, actionOpen } from './actionCard.js';
import type { CardHandler, CustomTask } from './types.js';

/**
 * ORCHARD sub-type membership. See the D1 ruling in the file header: the five
 * TIER 1 cards and nothing else, deliberately NOT the DL-42 title keyword,
 * because three cards outside the tier are named "Orchard" and none of them is
 * one. Three cards depend on this definition - O1's build refund, O13's grow
 * loop and O20's endgame count - and they must all read the same one.
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
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets: [self.card] });
  },
};

/**
 * O6 The Cherry Orchard - "Draw 2, then give 1 card from your hand to a
 * neighbour and take £1 from the bank."
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

/**
 * O9 The Fruit Stand - "Give any number of cards from your hand to your
 * neighbours, one each. Draw 2 for each."
 */
export const fruitStand: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The noun is CARDS YOU GIVE AWAY. Re-entrant: one card per answer, and "one each" is ' +
      'the clause that kills "is he getting more than me" - a seat that has already ' +
      'received drops out of the answer set for the rest of the activation. ⛔ DRAW 2 PER ' +
      'CARD, NEVER 1: at 1-for-1 the card is exactly worthless, and this has been written ' +
      'down three times and reverted twice. The task re-queues itself BEHIND its own Draw 2 ' +
      'so the replacement cards arrive before the next give is chosen. Skip stops.',
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

/** The re-entrant give-one-each loop (O9). Split out so the riders' shape is written once. */
function standTask(): CustomTask {
  return {
    answers(data, state, task) {
      const already = (task.riders.given as Seat[]) ?? [];
      const seats = giftableSeats(data, state, task.pid, already);
      const out = player(state, task.pid).hand.flatMap((card) =>
        seats.map((to) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
      );
      if (out.length === 0) return [];
      out.push({ kind: 'skip' });
      return out;
    },
    resolve(fx, task, answer) {
      if (answer.kind === 'skip') return true;
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
      fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets: [b.card] });
    }
  },
};

/**
 * O11 The Harvest Market - "Harvest this ORCHARD, however many cards are on it,
 * then Draw 1 for each card harvested."
 */
export const harvestMarket: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The noun is CARDS ON THIS BUILDING. ⚠️ The GROW payment is on the stack before ' +
      'activate runs, so the card that paid for the activation IS included in the harvest ' +
      'and in the draw count - intended, and asserted in the test. "However many cards are ' +
      'on it" is the printed exception to the full gate, so it uses fx.harvest directly ' +
      'rather than the action. Against O7: Golden harvests ANY ORCHARD and draws nothing, ' +
      'the Market harvests ITSELF and draws per card. Neither dominates.',
  },
  activate(fx, self) {
    const n = buildingOf(fx.state, self.seat, self.card).stack.length;
    fx.harvest(self.seat, self.card);
    drawN(fx, self.seat, self.card, n);
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
function grandGrowOptions(
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
 * O13 The Grand Orchard (ACTION) - "GROW each of your ORCHARDs in turn, paying
 * each cost as you go. Skip any you cannot or do not want to pay."
 */
export const grandOrchard: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: true },
    notes:
      'The hard one, and the card that attacks the measured problem in the whole game: GROW ' +
      'happens about 3.6 times per player per game and fires the printed ability on 58 of ' +
      '105 cards, so this buys the TRIGGER in bulk instead of inflating a payload. Each ' +
      'step is a REAL grow through doGrow - a matching card paid onto the stack, the ' +
      "surcharge, the ability, the Apiary Farmstead's rider - so nothing about a GROW is " +
      "re-implemented here. The loop re-queues itself BEHIND each activation's own tasks, " +
      'which is what makes the printed "in turn" true: the order is the player\'s and it ' +
      "matters (O7's harvest and O8's build both want to come after the draws that fund " +
      'them). Full ORCHARDs, unaffordable ones and ones already grown this activation all ' +
      'drop out of the answer set, so it can never grow one twice and never grows ITSELF ' +
      '(a Tier 3 card is not an ORCHARD under D1, and it prints no threshold either way). ' +
      'Capped by the hand, not the tableau: four ORCHARDs need four orchard cards out of 4.',
  },
  actionMoves: true,
  moves(data, state, self) {
    return actionMove(
      self,
      actionOpen(state, self) && grandGrowOptions(data, state, self.seat, []).length > 0,
    );
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'grandGrow',
      riders: { done: [] },
    });
  },
  tasks: {
    grandGrow: {
      answers(data, state, task) {
        const done = (task.riders.done as CardId[]) ?? [];
        const out = grandGrowOptions(data, state, task.pid, done).map(
          (o) =>
            ({ kind: 'card', payload: { building: o.building, payment: o.payment } }) as TaskAnswer,
        );
        if (out.length === 0) return [];
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('grandGrow expects a card answer');
        const building = answer.payload.building as CardId;
        doGrow(fx, task.pid, building, answer.payload.payment as CardId);
        // Re-queued AFTER the activation's own tasks (pushTask appends), so the
        // cards a grow draws are in hand before the next one is chosen.
        fx.pushTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'grandGrow',
          riders: { done: [...((task.riders.done as CardId[]) ?? []), building] },
        });
        return true;
      },
    },
  },
};

/**
 * O14 The Conservatory (ACTION) - "SOW every card in your hand onto your
 * buildings, then draw until your hand is full."
 */
export const conservatory: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
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
      "Apiary's identity is CROSS-TABLE sow, not sow as such.",
  },
  actionMoves: true,
  moves(data, state, self) {
    const p = player(state, self.seat);
    const limit = handLimitOf(data, state, self.seat);
    const canRefill = limit !== null && p.hand.length < limit && liveDecks(data, state).length > 0;
    const canSow = p.hand.length > 0 && p.tableau.some((b) => canTakeCard(data, b));
    return actionMove(self, actionOpen(state, self) && (canSow || canRefill));
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
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
 * O15 The Garden Library (ACTION) - "Take the top card of each deck. Give 1 to
 * each other player, keep the rest, and take £1 from the bank for each card
 * given."
 */
export const gardenLibrary: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The quantifier is THE TOP CARD OF EACH DECK, and its best property is that it ' +
      'self-balances across seat counts, which nothing else in the game does: two seats ' +
      'keep four and take £1, three keep three and take £2, four keep two and take £3. ' +
      '⛔ THIS IS NOT A DRAW, and the wording that prevents it is deliberate. It must not ' +
      'consult withDrawModifier, must not fire afterDrawKeep and must not reach the divert ' +
      'seam - so it is takeDeckTop into limbo, then passCard / cardsToHand, none of which ' +
      'touch the draw funnel. "Draw" means cards into your hand from decks of YOUR ' +
      'choosing; "take the top card of each deck" is a fixed reveal and triggers nothing. ' +
      'The £1 mints per card that actually crosses. A rival at their hand limit cannot ' +
      'receive (DL-63) and simply drops out, taking their £1 with them. ⚠️ Deck-top ' +
      'pressure: this is the first card to cut if reshuffles per played deck climb.',
  },
  actionMoves: true,
  moves(data, state, self) {
    return actionMove(self, actionOpen(state, self) && liveDecks(data, state).length > 0);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
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
        // Every rival served (or none can be): the forced answer keeps the rest.
        return out.length > 0 ? out : [{ kind: 'skip' }];
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

/** O16 The Orchard Keeper - "Whenever you VISIT a neighbour, Draw 1." */
export const orchardKeeper: CardHandler = {
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
      'visit and never fires it. Under D1 this card is no longer an ORCHARD.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.visitor !== self.seat) return;
      fx.autoDraw(self.seat, 1);
    },
  },
};

/**
 * O17 The Fruit Basket - "Whenever you discard a card, you may pay £1 to put it
 * into your barn instead."
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

/** O20 The Orchard Archive - "Game end: 2 VP for each ORCHARD you have built." */
export const orchardArchive: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Counts THE DEPTH OF THE GROVE, and matches W21 The Bread Hall exactly. It counts ' +
      'ORCHARDs rather than barn cards on purpose: the barn is scored at game end and ' +
      'delivering empties it, so any barn-counting endgame card would pay you for holding ' +
      'freight back from the island. Caps at 10 under D1 (five Tier 1 cards, 2 VP each) - ' +
      'the whole reason D1 had to be ruled, since the title-keyword reading would have ' +
      'counted itself, the Keeper and the Grand Orchard for up to 16 against a winning ' +
      'score of 38. ⚠️ It points the same way as the Barn rider and the printed 1 VP, so ' +
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
