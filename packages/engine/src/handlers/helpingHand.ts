/**
 * A Helping Hand - one Power card per suit (W18/V18/O18/A18/D18), identical
 * text on all five copies:
 *
 *   "When you VISIT a neighbour and WORK their Hired Worker, you may place a
 *    second card on their Notice Board to work it again."
 *
 * (Ticket 06 ruling A wording; the trigger is the visit's worker payoff, so it
 * can never fire off the Herb Hive's or the Prosperity Wagon's card-granted
 * WORK. The engine encodes that as: the gate reads `turn.visit`, which only a
 * real visit sets.)
 *
 * Mirrors the reference implementation's standing-gate design: this is NOT a
 * queue task. After a rival-Worker visit, the gate stays open and legalMoves
 * keeps offering the repeat until the visitor declines, runs out of cards or
 * repeats, the board clogs, or the Worker walks home. Duplicates stack: two
 * built copies allow two repeats per visit. The fee is a card, not a coin -
 * cards are the scarce resource and the master clock.
 */

import { workerActionLegal } from '../actions.js';
import { builtCopies, canTakeCard, noticeBoardOf, player, workerState } from '../query.js';
import { workWorker } from '../workers.js';
import type { CardHandler, CardMove } from './types.js';

export const helpingHand: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: false, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'The card that forced standing moves (handler.moves/applyMove) into the API. Not a ' +
      'prompt: the repeat is a fully-fledged optional MOVE between moves, offered by ' +
      'legalMoves while the visit gate is open. Denial is intended: repeating burns the ' +
      'Worker down its Working Week in half the turns.',
  },

  moves(data, state, self) {
    const visit = state.turn.visit;
    if (!visit || state.turnPlayer !== self.seat) return [];
    if (visit.repeats >= builtCopies(data, state, self.seat, 'Helping Hand')) return [];
    const worker = workerState(state, visit.workerId);
    if (worker.owner === null) return []; // walked home during this visit
    if (!workerActionLegal(data, state, self.seat, visit.workerId)) return [];
    if (!canTakeCard(data, noticeBoardOf(data, state, visit.host))) return [];
    return player(state, self.seat).hand.map((fee): CardMove => ({
      type: 'cardMove',
      seat: self.seat,
      card: self.card,
      kind: 'repeatWork',
      payload: { fee },
    }));
  },

  applyMove(fx, self, move) {
    const visit = fx.state.turn.visit;
    if (!visit) throw new Error('Helping Hand repeat with no visit in flight');
    const board = noticeBoardOf(fx.data, fx.state, visit.host);
    fx.placeOnBuilding(
      self.seat,
      { seat: visit.host, card: board.card },
      move.payload.fee as string,
    );
    visit.repeats += 1;
    // Re-work the same Worker: normal mode, so the meeple advances and the
    // host takes the next wage from the bank.
    workWorker(fx, self.seat, visit.workerId, { progress: true });
  },
};
