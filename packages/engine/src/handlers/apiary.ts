/**
 * Apiary handlers in the ticket-05 spanning set.
 */

import type { CardHandler } from './types.js';

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
      'never fires off it (ticket 06 ruling A: the trigger is the visit, not the WORK).',
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
