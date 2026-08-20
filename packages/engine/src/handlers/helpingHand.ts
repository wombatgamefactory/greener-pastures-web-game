/**
 * A Helping Hand - one Power card per suit (W18/V18/O18/A18/D18), identical
 * text on all five copies:
 *
 *   "When you VISIT a neighbour and use their Service, you may place a second
 *    card on it to use it again."
 *
 * RETEXTED 2026-08-10 with the suit Services, and the change is not cosmetic:
 * the second card lands on the SERVICE, not the Notice Board, because the
 * Service is the building the visit targeted. So a repeat drives the Service
 * toward its own threshold twice as fast, which is the denial play in its new
 * clothes - use their Service twice and you clog it, shutting the table out of
 * that action until they spend a Harvest on it.
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

import { payActionBranch, payServiceWage, workerActionLegal } from '../actions.js';
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
      'legalMoves while the visit gate is open. Denial is intended: repeating fills the ' +
      'Service toward its clog in half the turns.',
  },

  moves(data, state, self) {
    const visit = state.turn.visit;
    if (!visit || state.turnPlayer !== self.seat) return [];
    if (visit.repeats >= builtCopies(data, state, self.seat, 'Helping Hand')) return [];
    const worker = workerState(state, visit.workerId);
    if (worker.owner === null) return []; // walked home during this visit
    if (!workerActionLegal(data, state, self.seat, visit.workerId)) return [];
    // Change 6: the second card goes on the same NOTICE BOARD as the first.
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
    const service = noticeBoardOf(fx.data, fx.state, visit.host);
    fx.placeOnBuilding(
      self.seat,
      { seat: visit.host, card: service.card },
      move.payload.fee as string,
    );
    visit.repeats += 1;
    // Another card on their Service is another use bought, so the bank pays the
    // host another wage - the same funnel the visit itself uses - and, at an
    // upgraded Notice Board, pays the visitor the action branch's coin again.
    payServiceWage(fx, self.seat, visit.host, visit.workerId);
    payActionBranch(fx, self.seat, visit.host);
    workWorker(fx, self.seat, visit.workerId, { progress: true });
  },
};
