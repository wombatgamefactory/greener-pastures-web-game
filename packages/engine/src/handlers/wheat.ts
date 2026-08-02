/**
 * Wheat handlers - all 21 cards (ticket 18). Card texts are quoted from
 * cards.json (the sheet is the single source of truth for wording).
 *
 * Suit identity: Harvest. The Farmstead's relaxed gate and the upgraded
 * "Harvest is 2 buildings" repeat live in the engine's Harvest seams
 * (actions.ts harvestOptions / harvestAgainPower, game.ts `turn.again`), not
 * here - W2's entry documents where. W8's surcharge is engine-read via the
 * `harvestSurcharge` data trigger on the action paths; the cascade path
 * (W12/W13) runs through W8's own `surcharge` task.
 *
 * FIELD is a sub-type derived from the whole-word title keyword, following
 * the reference (DL-42): W4-W8, the only cards in the catalogue named Field.
 */

import type { GameData } from '@gp/data';

import type { Suit } from '@gp/data';

import { harvestSurchargeOf, placeBuilt } from '../actions.js';
import type { Fx } from '../fx.js';
import {
  cardById,
  drawableSuits,
  fullBuildings,
  isFull,
  player,
  upgradedBuildingCount,
} from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
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
 * The cascade shape shared by W12/W13 (reference: snapshot the qualifying
 * set, harvest each once, surcharge skip/pay per building). Surcharged
 * buildings become their own handler's `surcharge` task instead of an
 * immediate harvest; an unaffordable one auto-skips.
 */
function harvestCascade(fx: Fx, seat: Seat, buildings: CardId[]): void {
  for (const card of buildings) {
    if (harvestSurchargeOf(fx.data, card) > 0) {
      fx.pushTask({ t: 'card', pid: seat, src: card, kind: 'surcharge', riders: {} });
    } else {
      fx.harvest(seat, card);
    }
  }
}

/** W1 Barn (starter) - "Hand size 5." / upgraded "Hand size 7." */
export const wheatBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the printed hand size is read off the current face by handLimitOf ' +
      'and enforced by the end-of-turn discard in the turn flow.',
  },
};

/**
 * W2 Farmstead (starter) - "Harvest: Any card with 2+ cards on it, even if
 * not full." / upgraded adds "Harvest is 2 buildings."
 */
export const wheatFarmstead: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'Behaviour lives in the engine seams, not this entry: the base power is the relaxed ' +
      'gate in harvestOptions (union with strict-full; the gates genuinely cross at ' +
      'threshold 1), composing with the Harvest Worker via the harvestable task filter. ' +
      'The upgrade is the turn.again ActionAgain flow - one optional repeat of the MAIN ' +
      'Harvest action only, never a Worker harvest, following the reference. Card-effect ' +
      'harvests (W5/W10/W12/W13) do not inherit the relaxation.',
  },
};

/** W3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const wheatNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the visit (fee placement, coin/worker payoff, wage minting) is ' +
      "engine-level from ticket 17. The upgraded face's 2-cards-take-£3 mode is ticket 23.",
  },
};

/**
 * W4 Wheat Field - "Draw 1. This building automatically Harvests when full.
 * When this card is harvested: gain £1"
 */
export const wheatField: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Auto-harvest rides the placement funnel and fires for the OWNER whoever placed the ' +
      'filling card (a rival sow triggers it mid-rival-turn - crossPlayer). The £1 pays on ' +
      'any harvest of this building, auto or otherwise.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.onto.seat !== self.seat || event.onto.card !== self.card) return;
      const building = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
      if (building && isFull(fx.data, building)) fx.harvest(self.seat, self.card);
    },
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      fx.gainCoins(self.seat, 1, 'W4');
    },
  },
};

/** W5 Rye Field - "Draw 1. Harvest another card. When this card is harvested: gain £1" */
export const ryeField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Another card" = never itself (exclude rider). The harvest is the strict full gate - ' +
      'card effects do not inherit the Farmstead relaxation - and auto-skips with no target.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      exclude: self.card,
      then: 'harvest',
    });
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      fx.gainCoins(self.seat, 1, 'W5');
    },
  },
};

/** W6 Barley Field - "Draw 1. When harvested: Draw 2" */
export const barleyField: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"When harvested" is owner-scoped: a W11 cross-harvest draws for the building\'s ' +
      "owner, mid the activator's turn (cross-player tasks are supported, ticket 04).",
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      drawN(fx, self.seat, self.card, 2);
    },
  },
};

/** W7 Golden Field - "Draw 1. When harvested: Draw 1 and Build" */
export const goldenField: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: true },
    notes:
      'READING: "and Build" = a normal PAID build (the generic build task; auto-skips when ' +
      'nothing is buildable). The reference glosses its W7 task "free build", ambiguously - ' +
      'a free build of any card on a 2-cost tier 1 is far out of band, so the paid reading ' +
      'ships and the ambiguity is flagged for the rulings audit (ticket 07).',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      drawN(fx, self.seat, self.card, 1);
      fx.pushTask({ t: 'build', pid: self.seat, src: self.card });
    },
  },
};

/**
 * W8 Heritage Field - "Draw 1. You must pay £1 to Harvest this Field.
 * When harvested, draw 3."
 */
export const heritageField: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The surcharge is engine-read from the harvestSurcharge data trigger on every single- ' +
      'target path (action, Worker, chooseBuilding effects): unaffordable = not offered, ' +
      'chosen = £1 paid before the stack moves. This handler owns only the cascade path ' +
      '(W12/W13 push the surcharge task): pay £1 and harvest, or skip this building.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      drawN(fx, self.seat, self.card, 3);
    },
  },
  tasks: {
    surcharge: {
      answers(data, state, task) {
        const p = player(state, task.pid);
        const building = p.tableau.find((b) => b.card === task.src);
        if (!building || building.stack.length === 0) return [];
        if (p.coins < harvestSurchargeOf(data, task.src)) return [];
        return [{ kind: 'card', payload: { pay: true } }, { kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        fx.payCoins(task.pid, harvestSurchargeOf(fx.data, task.src), `surcharge:${task.src}`);
        fx.harvest(task.pid, task.src);
        return true;
      },
    },
  },
};

/**
 * W9 Mill House - "When harvested: £1 per unharvested FIELD card. You may
 * sow onto your FIELDs."
 */
export const millHouse: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'READING: "unharvested FIELD card" = every card currently on your FIELDs when the ' +
      "hook fires (after W9's own stack has moved - W9 is not a FIELD, so it never counts " +
      'itself). "Sow onto your FIELDs" = one optional sow per FIELD, W12\'s cascade pattern.',
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || event.building !== self.card) return;
      const fields = ownFields(fx.data, fx.state, self.seat);
      const loaded = fields.reduce((sum, b) => sum + b.stack.length, 0);
      fx.gainCoins(self.seat, loaded, 'W9');
      for (const field of fields) {
        fx.pushTask({
          t: 'sow',
          pid: self.seat,
          src: self.card,
          remaining: 1,
          targets: [field.card],
          optional: true,
        });
      }
    },
  },
};

/** W10 The Furrow - "Harvest. Gain £1. Then you may pay £1 to build a FIELD for free." */
export const furrow: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      '"Harvest." = one full building of yours, itself included if the grow payment filled ' +
      'it; strict gate. The £1 pays up front ("then" does not gate) so it can fund the ' +
      'field build. Free build = no card payment, via the shared placeBuilt landing so the ' +
      'Farmstead milestone still counts it.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      then: 'harvest',
    });
    fx.gainCoins(self.seat, 1, 'W10');
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'fieldBuild', riders: {} });
  },
  tasks: {
    fieldBuild: {
      answers(data, state, task) {
        const p = player(state, task.pid);
        if (p.coins < 1) return [];
        const fields = p.hand.filter((id) => isFieldCard(data, id));
        if (fields.length === 0) return [];
        const out: TaskAnswer[] = fields.map((card) => ({ kind: 'card', payload: { card } }));
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('fieldBuild expects a card answer');
        const card = answer.payload.card as CardId;
        fx.payCoins(task.pid, 1, 'W10');
        fx.removeFromHand(task.pid, card);
        // The shared landing half of Build, so the Farmstead milestone counts it.
        placeBuilt(fx, task.pid, card, [], 0);
        return true;
      },
    },
  },
};

/**
 * W11 The Bakehouse - "You may harvest a neighbour's building to their barn.
 * Gain £1 per card harvested."
 */
export const bakehouse: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      "Cross-player harvest: the stack goes to the NEIGHBOUR's barn and their on-harvest " +
      'passives fire - their choice tasks queue mid your turn (supported, ticket 04, where ' +
      "the reference drops them). Strict full gate; a neighbour's surcharged building (W8) " +
      'is offered only if the ACTIVATOR can pay, and the activator pays. The £1-per-card ' +
      'goes to the activator.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'harvestNeighbour',
      riders: {},
    });
  },
  tasks: {
    harvestNeighbour: {
      answers(data, state, task) {
        const p = player(state, task.pid);
        const out: TaskAnswer[] = [];
        for (let seat = 0; seat < state.players.length; seat++) {
          if (seat === task.pid) continue;
          for (const b of fullBuildings(data, state, seat)) {
            if (harvestSurchargeOf(data, b.card) > p.coins) continue;
            out.push({ kind: 'card', payload: { seat, building: b.card } });
          }
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('harvestNeighbour expects a card answer');
        const seat = answer.payload.seat as Seat;
        const building = answer.payload.building as CardId;
        const fee = harvestSurchargeOf(fx.data, building);
        if (fee > 0) fx.payCoins(task.pid, fee, `surcharge:${building}`);
        const stack = player(fx.state, seat).tableau.find((b) => b.card === building);
        const count = stack?.stack.length ?? 0;
        fx.harvest(seat, building);
        fx.gainCoins(task.pid, count, 'W11');
        return true;
      },
    },
  },
};

/** W12 Crop Rotation - "Harvest all ready FIELDs. You may SOW each FIELD." */
export const cropRotation: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'READING: "ready" = full (strict gate, no Farmstead relaxation). The cascade follows ' +
      'the reference: snapshot, harvest each once with W8 as a pay-or-skip surcharge task, ' +
      'then one optional sow per FIELD - every FIELD you own, the just-harvested ones ' +
      'having reopened.',
  },
  activate(fx, self) {
    const fields = ownFields(fx.data, fx.state, self.seat);
    const ready = fields.filter((b) => isFull(fx.data, b)).map((b) => b.card);
    harvestCascade(fx, self.seat, ready);
    for (const field of fields) {
      fx.pushTask({
        t: 'sow',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [field.card],
        optional: true,
      });
    }
  },
};

/** W13 The Bakery - "Harvest all your full buildings." */
export const bakery: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'Snapshot the full list before harvesting: the GROW payment can have just filled the ' +
      'Bakery itself, in which case it harvests too. A full W8 in the set becomes its ' +
      'pay-or-skip surcharge task (prompts); every other harvest runs inline, and order ' +
      'cannot matter because per-harvest listeners see each harvest separately.',
  },
  activate(fx, self) {
    const full = fullBuildings(fx.data, fx.state, self.seat).map((b) => b.card);
    harvestCascade(fx, self.seat, full);
  },
};

/** W14 The Pizzeria - "Take up to 4 cards from your buildings into your barn." */
export const pizzeria: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: true, interrupts: false },
    notes:
      'Re-entrant pick-one-card-at-a-time up to 4, skip to stop ("up to"). Card identity ' +
      'matters - stacks hold mixed suits and the barn tallies by suit - so every card on ' +
      'every stack is its own answer. NOT a harvest: buildings may reopen but no on-harvest ' +
      'passive fires (forced the stackCardToBarn primitive).',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'takeToBarn',
      riders: { remaining: 4 },
    });
  },
  tasks: {
    takeToBarn: {
      answers(_data, state, task) {
        if (((task.riders.remaining as number) ?? 0) <= 0) return [];
        const out: TaskAnswer[] = [];
        for (const b of player(state, task.pid).tableau) {
          for (const card of b.stack) {
            out.push({ kind: 'card', payload: { building: b.card, card } });
          }
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('takeToBarn expects a card answer');
        fx.stackCardToBarn(
          task.pid,
          answer.payload.building as CardId,
          answer.payload.card as CardId,
        );
        task.riders.remaining = (task.riders.remaining as number) - 1;
        return (task.riders.remaining as number) <= 0;
      },
    },
  },
};

/** W15 The Patisserie - "Place the top card of any deck into your barn, then gain £1." */
export const patisserie: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Then gain £1" does not gate (the W15/A5 reading), so the £1 pays inline up front - ' +
      'it survives even the freak case where every deck and discard is empty and the deck ' +
      'pick auto-skips.',
  },
  activate(fx, self) {
    fx.gainCoins(self.seat, 1, 'W15');
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'deckBarn', riders: {} });
  },
  tasks: {
    deckBarn: {
      answers(data, state) {
        return drawableSuits(data, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('deckBarn expects a card answer');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/** W16 The Granary - "Whenever you harvest: Draw 1." */
export const granary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Owner-scoped like the Pie Shop; fires once per building harvested, so a Bakery ' +
      'cascade draws several. A card-ability draw: the Orchard Farmstead modifier ' +
      'deliberately does not apply (reference DL-47).',
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** W17 The Pie Shop - "Whenever you harvest, gain £1 per non-wheat card in the harvest." */
export const pieShop: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '"You harvest" = you are the harvester, however the harvest happened (action, Bakery ' +
      'cascade, Harvest Worker). Fires once per building harvested.',
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat) return;
      const nonWheat = event.cards.filter((c) => cardById(fx.data, c).suit !== 'wheat').length;
      fx.gainCoins(self.seat, nonWheat, 'W17');
    },
  },
};

/** W19 The Wheat Exchange - "Game end: 3 VP for each of your upgraded buildings." */
export const wheatExchange: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Only the three starters upgrade and the free Farmstead flip counts (ticket 06 ruling ' +
      'C), so this caps at 9 VP. Functionally identical to A15 The Honey Hall by ruling.',
  },
  gameEnd(_data, state, seat) {
    return 3 * upgradedBuildingCount(state, seat);
  },
};

/** W20 The Grand Granary - "Game end: 2VP for each of your empty cards (fully harvested)." */
export const grandGranary: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'READING (the reference\'s scoring formula): an "empty (fully harvested)" card = a ' +
      'deck-built building with a printed threshold whose stack is empty at game end. State ' +
      'keeps no harvested-once memory, so a built-but-never-grown building counts too - ' +
      'exactly as a table would score it.',
  },
  gameEnd(data, state, seat) {
    const empties = player(state, seat).tableau.filter((b) => {
      const card = cardById(data, b.card);
      return card.inDeck && (card.threshold ?? null) !== null && b.stack.length === 0;
    });
    return 2 * empties.length;
  },
};

/** W21 The Bread Hall - "Game end: 1VP for every £2." */
export const breadHall: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      "REPLACES its holder's coin pity (the reference rule) - encoded as floor(coins/2) " +
      'minus the pity the runtime will add anyway, so the TOTAL is exact while the ' +
      "breakdown's coinPity line still shows the raw pity. Never negative: floor(c/2) >= " +
      'floor(c/divisor) for every divisor >= 2.',
  },
  gameEnd(data, state, seat) {
    const coins = player(state, seat).coins;
    const divisor = data.rules.economy.coinPityDivisor;
    const pity = divisor === null ? 0 : Math.floor(coins / divisor);
    return Math.floor(coins / 2) - pity;
  },
};
