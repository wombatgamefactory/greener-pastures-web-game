/**
 * Apiary handlers - all 21 cards (ticket 21; A4/A5/A18 date from the ticket-05
 * spanning set). Card texts are quoted from cards.json (the sheet is the
 * single source of truth for wording).
 *
 * Suit identity: Sow. The load-bearing rule is porting hazard 2: SOW IS
 * SUIT-FREE EVERYWHERE (ruled 2026-07-20) - the reference's strict placement
 * match must never be copied. Every sow below rides the generic suit-free sow
 * task or the shared placement funnel.
 *
 * The Farmstead lands as engine seams, not handler code: growOptions/doGrow
 * waive the payment match for an Apiary seat (the reference's
 * `Placement::checkNoType`), and doGrow queues the upgraded face's optional
 * follow-up sow (ticket 06 ruling F) after the activation's own tasks.
 *
 * HIVE is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42): A4-A8 and A13. The Pollinator Trail, Cross-Pollinator,
 * Wax Workshop, Honey Hut and Honeycomb Tower are not HIVEs.
 */

import type { GameData } from '@gp/data';

import { doHire, hireOptions } from '../actions.js';
import type { Fx } from '../fx.js';
import { canTakeCard, cardById, isFull, player, upgradedBuildingCount } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CardHandler } from './types.js';

const HIVE_NAME = /\bHive\b/;

/** HIVE sub-type membership, by whole-word title keyword (reference DL-42). */
export function isHiveCard(data: GameData, id: CardId): boolean {
  return HIVE_NAME.test(cardById(data, id).name);
}

function hives(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isHiveCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (no Farmstead modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/**
 * A1 Barn (starter) - "Hand size 5." / upgraded "Hand size 7."
 */
export const apiaryBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes: 'Hand size is engine-read from the printed face; no rider on either side.',
  },
};

/**
 * A2 Farmstead (starter) - "GROW: You may use any card." / upgraded adds
 * "When you GROW, you may SOW a second building." (ruling F wording: "you may
 * also SOW 1 card from your hand onto another of your buildings").
 */
export const apiaryFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in the engine seams, not this entry. Base: growOptions/doGrow waive ' +
      "the payment match for an Apiary seat (the reference's Placement::checkNoType). " +
      'Upgraded (ticket 06 ruling F): doGrow queues one OPTIONAL suit-free sow from hand ' +
      'onto another of your buildings - "another" excludes the just-grown building, the ' +
      "target does not activate, and the task queues after the activation's own tasks " +
      "(the reference's afterMainAction order).",
  },
};

/** A3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const apiaryNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the visit (fee placement, coin/worker payoff, wage minting) is ' +
      "engine-level from ticket 17. The upgraded face's 2-cards-take-£3 mode is ticket 23.",
  },
};

/** A5 The Meadow Hive - "Place a honey card directly into your barn, gain £1." */
export const meadowHive: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'READING: "a honey card" = the top card of the Apiary deck (the Patisserie precedent, ' +
      'W15). If deck and discard are both empty the barn part whiffs; the £1 still pays.',
  },
  activate(fx, self) {
    fx.deckTopToBarn(self.seat, 'apiary');
    fx.gainCoins(self.seat, 1, 'A5');
  },
};

/**
 * A4 The Herb Hive - "WORK another player's Hired Worker for free. Do not
 * progress the worker. The owner gains £1 from bank."
 */
export const herbHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      'The card that forced the free-work mode (progress: false - no meeple advance, so no ' +
      'wage) and the ownerCoins rider. Nests a worker use inside a GROW; a Helping Hand ' +
      'never fires off it (ticket 06 ruling A: the trigger is the visit, not the WORK). ' +
      'A17 The Smoke Pot DOES fire off it - the afterWork hook reports free works too.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseWorker',
      pid: self.seat,
      src: self.card,
      owned: 'rival',
      progress: false,
      ownerCoins: 1,
    });
  },
};

/** A6 The Garden Hive - "You may sow the top card from any discard pile onto one of your buildings." */
export const gardenHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The only card that places from anywhere but a hand - it forced the placeFromDiscard ' +
      'primitive (same landing tail as every placement, so the Veil and W4 compose). "Top" ' +
      '= the most recently discarded card of the chosen suit. Suit-free target, own ' +
      'buildings only, optional; auto-skips when every discard is empty or nothing is open.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'discardSow', riders: {} });
  },
  tasks: {
    discardSow: {
      answers(data, state, task) {
        // One answer per (top card, target): the choice offered is the TOP of a
        // pile, so nothing here can reach deeper and attach value to pile order.
        const tops = data.cards.suits
          .map((s) => state.discards[s]?.at(-1))
          .filter((id): id is CardId => id !== undefined);
        const targets = player(state, task.pid).tableau.filter((b) => canTakeCard(data, b));
        const out: TaskAnswer[] = [];
        for (const card of tops) {
          for (const b of targets) out.push({ kind: 'card', payload: { card, onto: b.card } });
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('discardSow expects a card answer');
        const onto = answer.payload.onto as CardId;
        fx.placeFromDiscard(
          task.pid,
          { seat: task.pid, card: onto },
          answer.payload.card as CardId,
        );
        return true;
      },
    },
  },
};

/** A7 The Foraging Hive - "Sow 1 card onto one of your Hives, then Draw 1." */
export const foragingHive: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Imperative sow = mandatory (the ticket 18/19 convention), HIVE targets only, ' +
      'suit-free, snapshot at activation. "Then Draw 1" does not gate (the W15 reading): ' +
      'the draw runs even when no hive can take a card and the sow auto-skips.',
  },
  activate(fx, self) {
    const targets = hives(fx.data, fx.state, self.seat)
      .filter((b) => canTakeCard(fx.data, b))
      .map((b) => b.card);
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets });
    drawN(fx, self.seat, self.card, 1);
  },
};

/**
 * A8 The Wild Hive - "You must pay £1 to activate this card (in addition to
 * the card). You may then immediately harvest this building."
 */
export const wildHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The £1 is an engine-level activation surcharge (activationSurchargeOf, keyed on the ' +
      "data trigger like W8's harvest surcharge): gated in growOptions, checked before and " +
      'paid after the card lands (the reference order). The harvest is OPTIONAL ("you ' +
      'may"), a card-effect harvest of this building only - at threshold 1 the grow ' +
      'payment has just filled it.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'selfHarvest', riders: {} });
  },
  tasks: {
    selfHarvest: {
      answers() {
        return [{ kind: 'card', payload: { harvest: true } }, { kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        fx.harvest(task.pid, task.src);
        return true;
      },
    },
  },
};

/** A9 The Pollinator Trail - "You may sow 1 honey onto each of your HIVE cards, gain £1 per card sown." */
export const pollinatorTrail: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'One OPTIONAL sow task per open HIVE, each minting £1 when a card is actually sown ' +
      '(the reference\'s exact-count rewrite - never a flat payout). "1 honey" reads as 1 ' +
      'card from hand, any suit (sow is suit-free; porting hazard 2 names this card). ' +
      'Targets snapshot at activation.',
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (!canTakeCard(fx.data, b)) continue;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'paidSow',
        riders: { target: b.card },
      });
    }
  },
  tasks: {
    paidSow: {
      answers(data, state, task) {
        const target = player(state, task.pid).tableau.find(
          (b) => b.card === (task.riders.target as CardId),
        );
        if (!target || !canTakeCard(data, target)) return [];
        const out: TaskAnswer[] = player(state, task.pid).hand.map((card) => ({
          kind: 'card',
          payload: { card },
        }));
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('paidSow expects a card answer');
        const onto = task.riders.target as CardId;
        fx.placeOnBuilding(task.pid, { seat: task.pid, card: onto }, answer.payload.card as CardId);
        fx.gainCoins(task.pid, 1, 'A9');
        return true;
      },
    },
  },
};

/** A10 The Cross-Pollinator - "HIRE a Hired Worker, paying £1 less." */
export const crossPollinator: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Imperative = mandatory when legal (the player chose to grow it). Rides the real ' +
      'hire funnel with a £1 discount (fee floors at 0), so the max-1-per-player gate and ' +
      'the Fair-only rule hold; auto-skips when already staffed, broke or the Fair is empty.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'hire', riders: {} });
  },
  tasks: {
    hire: {
      answers(data, state, task) {
        return hireOptions(data, state, task.pid, 1).map((w) => ({ kind: 'worker', workerId: w }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'worker') throw new Error('hire expects a worker answer');
        doHire(fx, task.pid, answer.workerId, 1);
        return true;
      },
    },
  },
};

/** A11 The Wax Workshop - "Harvest one of your HIVEs with 2+ cards, even if it is not full." */
export const waxWorkshop: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      "The 2+ gate ALONE, not a union with strict-full (the reference's minLoadedOnly): a " +
      'full threshold-1 hive (A8 holding 1) is refused. Mandatory, auto-skips when no hive ' +
      "holds 2+. HIVEs only - the Apiary suit's self-harvest valve.",
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'harvestHive', riders: {} });
  },
  tasks: {
    harvestHive: {
      answers(data, state, task) {
        return hives(data, state, task.pid)
          .filter((b) => b.stack.length >= 2)
          .map((b) => ({ kind: 'building', card: b.card }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'building') throw new Error('harvestHive expects a building answer');
        fx.harvest(task.pid, answer.card);
        return true;
      },
    },
  },
};

/** A12 The Honey Hut - "Sow 1 card from your hand onto a rival's building, then Draw 3." */
export const honeyHut: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The cross-table sow (suit-free, any rival building that can take a card - Notice ' +
      'Boards included). Imperative = mandatory (the ticket 18/19 convention); auto-skips ' +
      'when every rival building is clogged or the hand is empty. "Then Draw 3" does not ' +
      "gate (the W15/A5 reading). The rival's W4/Veil placement reactors compose via the " +
      'shared funnel.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'sowRival', riders: {} });
    drawN(fx, self.seat, self.card, 3);
  },
  tasks: {
    sowRival: {
      answers(data, state, task) {
        const out: TaskAnswer[] = [];
        for (const card of player(state, task.pid).hand) {
          for (let seat = 0; seat < state.players.length; seat++) {
            if (seat === task.pid) continue;
            for (const b of player(state, seat).tableau) {
              if (canTakeCard(data, b))
                out.push({ kind: 'card', payload: { card, seat, onto: b.card } });
            }
          }
        }
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('sowRival expects a card answer');
        fx.placeOnBuilding(
          task.pid,
          { seat: answer.payload.seat as Seat, card: answer.payload.onto as CardId },
          answer.payload.card as CardId,
        );
        return true;
      },
    },
  },
};

/** A13 The Queen's Hive - "You may sow all your HIVES." */
export const queensHive: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'One optional suit-free sow per open HIVE, targets snapshot at activation (the ' +
      'sow-each cascade the Orchard shares). Itself a HIVE (DL-42) and open at 1-of-2 ' +
      'after its own grow payment, so it may sow itself. Pushed while the queue is empty, ' +
      "so the reference's prepend-before-the-gate ordering holds by construction - the " +
      "upgraded Farmstead's follow-up sow still lands behind these.",
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (!canTakeCard(fx.data, b)) continue;
      fx.pushTask({
        t: 'sow',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [b.card],
        optional: true,
      });
    }
  },
};

/** A14 The Honeycomb Tower - "Draw 1 for each of your full Hives." */
export const honeycombTower: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes: 'Counts own HIVEs at their printed threshold. A full A8 (1-of-1) counts.',
  },
  activate(fx, self) {
    const full = hives(fx.data, fx.state, self.seat).filter((b) => isFull(fx.data, b)).length;
    drawN(fx, self.seat, self.card, full);
  },
};

/** A15 The Royal Apiary - "You may immediately deliver." */
export const royalApiary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      '"You may" = the optional flag it forced onto the shared deliver task (island AND ' +
      "balloon branches, DL-12) - unlike O15's mandatory deliver. Auto-skips when nothing " +
      'is deliverable.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card, optional: true });
  },
};

/** A16 The Beekeeper's Veil - "Whenever you place a card that brings a building's stack to 2 cards, Draw 1." (ruling G) */
export const beekeepersVeil: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Placer-scoped placement reactor (ruling G): stack POSITION 2, any board - your own ' +
      'grow payment or sow, or your visit fee landing on a Notice Board holding one card. ' +
      'Never fires when a rival brings YOUR building to 2. No per-turn limit. The draw is ' +
      'a normal see-1/keep-1 picker.',
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.stackSize !== 2) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** A17 The Smoke Pot - "When a rival WORKs your Hired Worker, Draw 1." */
export const smokePot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The card that forced the afterWork hook (fired by workWorker on every path). ' +
      "Owner-side, rival works only - a visit's payoff, a Helping Hand repeat, the Herb " +
      "Hive's free WORK and the Prosperity Wagon all count; your own uses never. The draw " +
      "is a choiceless own-suit-fallback autoDraw (the reference's auto-draw - no picker " +
      'mid-rival-turn), so it can never fire O17 or re-enter.',
  },
  on: {
    afterWork(fx, event, self) {
      if (event.owner !== self.seat) return;
      if (event.actor === self.seat) return;
      fx.autoDraw(self.seat, 1);
    },
  },
};

/** A19 The Honey Hall - "Game end: 3 VP for each of your upgraded buildings." */
export const honeyHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Only the three starters upgrade (ruling C), so this caps at 9 VP; the free ' +
      'Farmstead flip counts. Deliberately identical to W19 (ruling C: intentional).',
  },
  gameEnd(_data, state, seat) {
    return 3 * upgradedBuildingCount(state, seat);
  },
};

/** A20 The Apiarist's Guild - "Game end: 2VP for each of your buildings with 1 or more cards loaded." */
export const apiaristsGuild: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Counts loaded stacks across the whole tableau - the Notice Board included (a ' +
      'building, holds cards). Powers/endgame cards have no stack and never count.',
  },
  gameEnd(_data, state, seat) {
    return 2 * player(state, seat).tableau.filter((b) => b.stack.length >= 1).length;
  },
};

/** A21 The Wax Hall - "Score 2 VP for each HIVE card you have built." */
export const waxHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes: 'HIVE sub-type count (DL-42): A4-A8 and A13. The Wax Hall itself is not a HIVE.',
  },
  gameEnd(data, state, seat) {
    return 2 * hives(data, state, seat).length;
  },
};
