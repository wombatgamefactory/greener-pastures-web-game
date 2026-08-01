/**
 * Wheat handlers in the ticket-05 spanning set. Card texts are quoted from
 * cards.json (the sheet is the single source of truth for wording).
 */

import { cardById, fullBuildings, upgradedBuildingCount } from '../query.js';
import type { CardHandler } from './types.js';

/** W13 The Bakery - "Harvest all your full buildings." */
export const bakery: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Snapshot the full list before harvesting: the GROW payment can have just filled the ' +
      'Bakery itself, in which case it harvests too. No choice, no prompt - order cannot ' +
      'matter because per-harvest listeners see each harvest separately.',
  },
  activate(fx, self) {
    const full = fullBuildings(fx.data, fx.state, self.seat).map((b) => b.card);
    for (const card of full) fx.harvest(self.seat, card);
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
