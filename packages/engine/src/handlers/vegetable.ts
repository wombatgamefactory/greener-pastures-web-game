/**
 * Vegetable handlers - all 21 cards plus the Aerodrome-reactive family
 * (ticket 19). Card texts are quoted from cards.json (the sheet is the single
 * source of truth for wording; ticket 13's Port -> Aerodrome retexts are
 * cosmetic and the ruled behaviour is implemented either way).
 *
 * Suit identity: Deliver. The engine seams are module-level, not per-card:
 * moving a balloon IS the Deliver action (reference DL-12, actions.ts
 * doMoveBalloon / balloonMoveOptions), every card-effect "Deliver" therefore
 * offers island AND freight through deliverAnswers, and the Farmstead's
 * deliver coin plus the Barn's freight refund ride the afterDeliver hook the
 * two funnels share.
 *
 * DEPOT is a sub-type derived from the whole-word title keyword, following
 * the reference (DL-42): V4-V8, the only cards in the catalogue named Depot.
 */

import type { GameData, Suit } from '@gp/data';

import {
  balloonMoveOptions,
  barnTally,
  deliverAnswers,
  deliverDemands,
  doDeliver,
  doMoveBalloon,
} from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, player } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CardHandler } from './types.js';

const DEPOT_NAME = /\bDepot\b/;

/** DEPOT sub-type membership, by whole-word title keyword (reference DL-42). */
export function isDepotCard(data: GameData, id: CardId): boolean {
  return DEPOT_NAME.test(cardById(data, id).name);
}

function builtDepots(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isDepotCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Cards a deliver-or-balloon answer spends - the freight cost counts (V11/V13's reading). */
function spendSize(answer: TaskAnswer): number {
  if (answer.kind !== 'deliver' && answer.kind !== 'balloon') return 0;
  return (Object.values(answer.spend) as number[]).reduce((a, b) => a + b, 0);
}

/** Apply a deliver-or-balloon answer for a card task. Returns the spend's per-suit map. */
function applyDeliverAnswer(fx: Fx, pid: Seat, answer: TaskAnswer): Partial<Record<Suit, number>> {
  if (answer.kind === 'deliver') {
    doDeliver(fx, pid, answer.tile, answer.spend);
    return answer.spend;
  }
  if (answer.kind === 'balloon') {
    doMoveBalloon(fx, pid, answer.balloon, answer.spend);
    return answer.spend;
  }
  throw new Error('Expected a deliver or balloon answer');
}

/** V1 Barn (starter) - "Hand size 5." / upgraded adds "When you Deliver and the delivery has a Vegetable, return 1 Vegetable to barn." */
export const vegetableBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Hand size is engine-read. The upgraded freight refund fires on ANY Deliver (island ' +
      'or balloon - the reference keys it off upgrade state, not an island-only trigger): ' +
      'one just-spent Vegetable comes back from the discard (forced the reclaimDiscard ' +
      'primitive). No choice - barn identity is inert, so the first spent Vegetable id ' +
      'serves. A free V16 move spends nothing, so nothing refunds.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (event.seat !== self.seat) return;
      const barn = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
      if (!barn?.upgraded) return;
      const veg = event.cards.find((id) => cardById(fx.data, id).suit === 'vegetable');
      if (veg !== undefined) fx.reclaimDiscard(self.seat, veg);
    },
  },
};

/** V2 Farmstead (starter) - "When you Deliver, gain £1." / upgraded "£2." */
export const vegetableFarmstead: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The suit power as a passive on the shared afterDeliver hook (which it forced): any ' +
      'Deliver by the holder - island, balloon, via the Deliver Worker (suit powers apply ' +
      'to Worker actions), or a card-effect Deliver - mints the coin. Locked: never a ' +
      'card or colour discount.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (event.seat !== self.seat) return;
      const farmstead = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
      fx.gainCoins(self.seat, farmstead?.upgraded ? 2 : 1, 'V2');
    },
  },
};

/** V3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const vegetableNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs (coin, ' +
      "worker, the upgraded face's 2-cards-take-£3 mode) and the wage minting - is " +
      'engine-level.',
  },
};

/** V4 The Market Stall Depot - "Deliver." */
export const marketStallDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The generic deliver task: island tiles AND balloon moves (a balloon move IS a ' +
      'Deliver, DL-12). Imperative text = mandatory when an option exists; auto-skips ' +
      'with an empty barn.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
};

/** V5 The Coastal Trading Depot - "Move a Balloon to your zone and collect the reward." */
export const coastalTradingDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'The balloon-only half of the Deliver action, at the normal 2-differing-barn-cards ' +
      'cost (the first card through the doMoveBalloon machinery). Imperative = mandatory ' +
      'when affordable; auto-skips otherwise. Ticket 13 retexts "zone" to "Aerodrome" - ' +
      'same behaviour.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'moveBalloon', riders: {} });
  },
  tasks: {
    moveBalloon: {
      answers(data, state, task) {
        return balloonMoveOptions(data, state, task.pid).map(
          (o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'balloon') throw new Error('moveBalloon expects a balloon answer');
        doMoveBalloon(fx, task.pid, answer.balloon, answer.spend);
        return true;
      },
    },
  },
};

/** V6 The Trade Depot - "Deliver; if the delivery included a Vegetable, Deliver again." */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'READING: no chain - "the delivery" is the first one, so the second Deliver never ' +
      'earns a third whatever it spends (flagged to the rulings audit, ticket 07). A ' +
      "balloon move's two cost cards count as the delivery for the Vegetable test, " +
      'matching the any-mix framing.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'deliverChain', riders: {} });
  },
  tasks: {
    deliverChain: {
      answers(data, state, task) {
        return deliverAnswers(data, state, task.pid);
      },
      resolve(fx, task, answer) {
        const spend = applyDeliverAnswer(fx, task.pid, answer);
        if ((spend.vegetable ?? 0) >= 1) {
          fx.pushTask({ t: 'deliver', pid: task.pid, src: task.src });
        }
        return true;
      },
    },
  },
};

/** V7 The Export Depot - "Deliver up to twice (any mix of island and freight)." */
export const exportDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Up to" = each of the two Delivers is skippable, and skipping one skips its ' +
      'sibling too (the task is one re-entrant picker with a remaining rider).',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'deliverUpTo',
      riders: { remaining: 2 },
    });
  },
  tasks: {
    deliverUpTo: {
      answers(data, state, task) {
        if (((task.riders.remaining as number) ?? 0) <= 0) return [];
        const out = deliverAnswers(data, state, task.pid);
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        applyDeliverAnswer(fx, task.pid, answer);
        task.riders.remaining = ((task.riders.remaining as number) ?? 0) - 1;
        return (task.riders.remaining as number) <= 0;
      },
    },
  },
};

/** V8 The Regional Depot - "Pay £1: Deliver, then move a Balloon and collect the reward." */
export const regionalDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '"Pay £1:" prices the WHOLE effect (the reference reading): with less than £1 the ' +
      'activation does nothing. "Then" does not gate - the balloon move runs even when ' +
      'the Deliver auto-skipped. Both steps mandatory-when-possible.',
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).coins < 1) return;
    fx.payCoins(self.seat, 1, 'V8');
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'moveBalloon', riders: {} });
  },
  tasks: {
    moveBalloon: {
      answers(data, state, task) {
        return balloonMoveOptions(data, state, task.pid).map(
          (o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'balloon') throw new Error('moveBalloon expects a balloon answer');
        doMoveBalloon(fx, task.pid, answer.balloon, answer.spend);
        return true;
      },
    },
  },
};

/** V9 The Merchant Guild - "Deliver, then harvest 1 of your full buildings." */
export const merchantGuild: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Then" does not gate: the harvest runs even when the Deliver auto-skipped. Strict ' +
      'full gate (card effects never inherit the Wheat relaxation); targets enumerate ' +
      'AFTER the deliver resolves, so a building the grow payment just filled qualifies.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      then: 'harvest',
    });
  },
};

/** V10 The Supply House - "Deliver, then SOW up to 2 cards onto your own buildings." */
export const supplyHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Up to 2" = the sow task is optional (skip stops early). Sow is suit-free (ruled ' +
      '2026-07-20) and the generic task already restricts targets to your own buildings.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 2, optional: true });
  },
};

/** V11 The Market Master - "Deliver; draw 1 for each card you delivered." */
export const marketMaster: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'READING: "cards you delivered" = the cards the Deliver spent, so an island L1 tile ' +
      "draws 2 and a balloon move's freight cost draws 2 (flagged with V6's reading to " +
      'ticket 07). A card-ability draw: the Orchard modifier does not apply.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'deliverCount', riders: {} });
  },
  tasks: {
    deliverCount: {
      answers(data, state, task) {
        return deliverAnswers(data, state, task.pid);
      },
      resolve(fx, task, answer) {
        const n = spendSize(answer);
        applyDeliverAnswer(fx, task.pid, answer);
        drawN(fx, task.pid, task.src, n);
        return true;
      },
    },
  },
};

/** V12 The Auction House - "Deliver; you may treat any 1 card as a Vegetable for this delivery." */
export const auctionHouse: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      "One-card wild substitution (forced doDeliver's countAs parameter): one unit of a " +
      "tile's Vegetable demand may be paid by any suit. Enumerates against the demand-side " +
      'spends (deliverDemands), so an otherwise-unaffordable tile becomes an option. ' +
      'Balloon moves need no substitution (their cost is already any-2-differing).',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'deliverSub', riders: {} });
  },
  tasks: {
    deliverSub: {
      answers(data, state, task) {
        const out = deliverAnswers(data, state, task.pid);
        const tally = barnTally(data, state, task.pid);
        for (const d of deliverDemands(data, state, task.pid)) {
          if ((d.spend.vegetable ?? 0) < 1) continue;
          for (const from of state.suitsInPlay) {
            if (from === 'vegetable') continue;
            const spend: Partial<Record<Suit, number>> = { ...d.spend };
            const veg = (spend.vegetable as number) - 1;
            if (veg === 0) delete spend.vegetable;
            else spend.vegetable = veg;
            spend[from] = (spend[from] ?? 0) + 1;
            const affordable = (Object.entries(spend) as [Suit, number][]).every(
              ([s, n]) => (tally[s] ?? 0) >= n,
            );
            if (!affordable) continue;
            out.push({
              kind: 'card',
              payload: { tile: d.tile, spend, sub: from },
            });
          }
        }
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'deliver' || answer.kind === 'balloon') {
          applyDeliverAnswer(fx, task.pid, answer);
          return true;
        }
        if (answer.kind !== 'card') throw new Error('deliverSub expects a deliver answer');
        const { tile, spend, sub } = answer.payload as {
          tile: string;
          spend: Partial<Record<Suit, number>>;
          sub: Suit;
        };
        doDeliver(fx, task.pid, tile, spend, [{ from: sub, to: 'vegetable' }]);
        return true;
      },
    },
  },
};

/** V13 The Grand Marketplace - "Deliver up to 4 cards (any mix of island and freight)." */
export const grandMarketplace: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      "The reference's mutable budget rider: deliver steps re-offer while the 4-card " +
      'budget affords one (island L1 = 2 cards, L2 = 4, balloon = 2). Skippable at every ' +
      'step ("up to"); auto-skips once nothing fits the remaining budget.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'deliverBudget',
      riders: { remaining: 4 },
    });
  },
  tasks: {
    deliverBudget: {
      answers(data, state, task) {
        const remaining = (task.riders.remaining as number) ?? 0;
        const out = deliverAnswers(data, state, task.pid).filter((a) => spendSize(a) <= remaining);
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        const cost = spendSize(answer);
        applyDeliverAnswer(fx, task.pid, answer);
        task.riders.remaining = ((task.riders.remaining as number) ?? 0) - cost;
        return (task.riders.remaining as number) <= 0;
      },
    },
  },
};

/** V14 The Distribution Center - "Deliver once for each Depot you have built." */
export const distributionCenter: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Snapshot the Depot count (whole-word title keyword, V4-V8) at activation, then ' +
      'that many generic deliver tasks - each island-or-balloon, each mandatory when an ' +
      'option exists, each auto-skipping when the barn runs dry.',
  },
  activate(fx, self) {
    const depots = builtDepots(fx.data, fx.state, self.seat).length;
    for (let i = 0; i < depots; i++) {
      fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
    }
  },
};

/**
 * V15 The International Port - "Move one Balloon from each neighbour's Port
 * (pay the normal cost for each) and collect the rewards."
 */
export const internationalPort: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'One bound task per neighbour whose Aerodrome holds a balloon, each independently ' +
      'affordable and skippable (the reference shape). The raids read rival Aerodromes ' +
      'but touch no rival zone; a raided V17 owner draws mid-effect. The card name keeps ' +
      '"Port" by ruling; only rules text migrates to "Aerodrome".',
  },
  activate(fx, self) {
    const aero = fx.state.aerodrome;
    if (!aero) return;
    for (let host = 0; host < fx.state.players.length; host++) {
      if (host === self.seat) continue;
      if (!aero.balloons.some((b) => b.at === host)) continue;
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'raid', riders: { host } });
    }
  },
  tasks: {
    raid: {
      answers(data, state, task) {
        const aero = state.aerodrome;
        if (!aero) return [];
        const host = task.riders.host as Seat;
        const atHost = new Set(aero.balloons.filter((b) => b.at === host).map((b) => b.id));
        const out = balloonMoveOptions(data, state, task.pid)
          .filter((o) => atHost.has(o.balloon))
          .map((o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer);
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'balloon') throw new Error('raid expects a balloon answer');
        doMoveBalloon(fx, task.pid, answer.balloon, answer.spend);
        return true; // "one Balloon from EACH neighbour" - one per host task.
      },
    },
  },
};

/**
 * V16 The Market Signal Tower - "When you Deliver to the island, you may also
 * move a Balloon for free and collect the reward"
 */
export const marketSignalTower: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'Island deliveries ONLY (the onDeliverIsland trigger; a balloon move fires the ' +
      'ungated hook, so V16 cannot recurse off its own free move - reference DL-15). The ' +
      'free move (doMoveBalloon spend null - the mode this card forced) pays no cards; ' +
      'the raid hook, the deliver hook and the reward all still fire.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (!event.island || event.seat !== self.seat) return;
      if (!fx.state.aerodrome) return;
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'freeMove', riders: {} });
    },
  },
  tasks: {
    freeMove: {
      answers(_data, state, task) {
        const aero = state.aerodrome;
        if (!aero) return [];
        const out: TaskAnswer[] = aero.balloons
          .filter((b) => b.at !== task.pid)
          .map((b) => ({ kind: 'card', payload: { balloon: b.id } }));
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('freeMove expects a balloon answer');
        doMoveBalloon(fx, task.pid, answer.payload.balloon as string, null);
        return true;
      },
    },
  },
};

/** V17 The Dockworker's Union - "When a neighbour moves a Balloon away from your Port, Draw 1." */
export const dockworkersUnion: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'The afterBalloonMove hook (which it forced): fires when the balloon left THIS ' +
      "owner's Aerodrome and the mover is someone else. The draw is the owner's, queued " +
      "mid the mover's turn (cross-player tasks are supported, ticket 04). Live in every " +
      'game the module is in - the "dead at one Veg player" flag was withdrawn (ruling I).',
  },
  on: {
    afterBalloonMove(fx, event, self) {
      if (event.from !== self.seat || event.seat === self.seat) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** V19 The Market Gazette - "Game end: Gain 5VP if you trigger the end of the game." */
export const marketGazette: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The end trigger is the FIRST Level-3 delivery and is stored with its seat, so ' +
      '"you trigger the end" is a single stored-state check.',
  },
  gameEnd(_data, state, seat) {
    return state.endTrigger?.seat === seat ? 5 : 0;
  },
};

/** V20 The Trading Commission - "Game end: 1 VP per Depot you have built." */
export const tradingCommission: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes: 'DEPOT = the whole-word title keyword, exactly V4-V8, so this caps at 5 VP.',
  },
  gameEnd(data, state, seat) {
    return builtDepots(data, state, seat).length;
  },
};

/** V21 The Harvest Ledger - "Game end: 2 VP per different crop colour in your barn." */
export const harvestLedger: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Distinct suits among the barn cards at game end (max 10 VP at five suits) - ' +
      'countable from the public per-suit tally, like every endgame formula.',
  },
  gameEnd(data, state, seat) {
    const suits = new Set(player(state, seat).barn.map((id) => cardById(data, id).suit));
    return 2 * suits.size;
  },
};
