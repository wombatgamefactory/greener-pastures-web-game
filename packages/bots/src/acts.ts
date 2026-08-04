/**
 * What a move DOES, with the two spellings of the same act collapsed.
 *
 * The engine deliberately offers a Deliver twice - as the `deliver` MOVE and as
 * the `deliver` ANSWER to the Deliver Worker's task - because both go through
 * one enumerator (ticket 19). A scoring term that only knew about the move type
 * would value the Worker's delivery at zero, so every term reads an `Act`
 * instead: normalise once here, and "Deliver is absolute" holds wherever a
 * delivery appears.
 */

import type { Suit, WorkerAction } from '@gp/data';
import type { CardId, Move, Seat, TaskAnswer } from '@gp/engine';

type Spend = Partial<Record<Suit, number>>;

export type Act =
  | { a: 'draw' }
  | { a: 'buy'; suit: Suit }
  /**
   * `payment` is hand cards, `coinWild` coins standing in for cards (D7) and
   * `barn` barn cards joining the payment (D8). The engine holds
   * `payment.length + barn + coinWild === cardsNeeded`, so the three are ways of
   * paying ONE price and a term that reads only their sum can never tell them
   * apart - which is what ticket 47 found `buildSpend` doing.
   *
   * `barn` is a COUNT and its suits are deliberately dropped. Ticket 51 went
   * looking for them, to price WHICH barn card a D8 build burns, and measured the
   * leg as empty: 0.2% of 896 build groups over 55 games offered a barn card at
   * all, and no chosen move ever spent one. Carrying the suit map to serve that
   * would be surface for nothing.
   */
  | { a: 'build'; card: CardId; payment: readonly CardId[]; coinWild: number; barn: number }
  | { a: 'hire'; workerId: WorkerAction }
  | { a: 'upgrade'; card: CardId }
  | { a: 'grow'; building: CardId; payment: CardId }
  | { a: 'harvest'; building: CardId }
  | { a: 'deliver'; tile: string; spend: Spend }
  | { a: 'balloon'; balloon: string; spend: Spend }
  | {
      a: 'visit';
      host: Seat;
      fee: readonly CardId[];
      payoff: Extract<Move, { type: 'visit' }>['payoff'];
    }
  | { a: 'workOwn'; workerId: WorkerAction }
  | { a: 'cardMove'; card: CardId; kind: string; payload: Record<string, unknown> }
  | { a: 'pass' }
  | { a: 'endTurn' }
  /** Task answers with no main-move twin. */
  | { a: 'worker'; workerId: WorkerAction }
  | { a: 'deckPick'; suit: Suit }
  | { a: 'keep'; cards: readonly CardId[] }
  | { a: 'sow'; card: CardId; onto: CardId }
  | { a: 'discard'; cards: readonly CardId[] }
  | { a: 'skip' }
  | { a: 'cardTask'; payload: Record<string, unknown> };

function actOfAnswer(answer: TaskAnswer): Act {
  switch (answer.kind) {
    case 'worker':
      return { a: 'worker', workerId: answer.workerId };
    case 'deck':
      return { a: 'deckPick', suit: answer.suit };
    case 'keep':
      return { a: 'keep', cards: answer.cards };
    // chooseBuilding's only `then` is 'harvest', so this IS a harvest.
    case 'building':
      return { a: 'harvest', building: answer.card };
    case 'sow':
      return { a: 'sow', card: answer.card, onto: answer.onto };
    case 'build':
      return {
        a: 'build',
        card: answer.card,
        payment: answer.payment,
        coinWild: answer.coinWild ?? 0,
        barn: spendSize(answer.barn ?? {}),
      };
    case 'deliver':
      return { a: 'deliver', tile: answer.tile, spend: answer.spend };
    case 'balloon':
      return { a: 'balloon', balloon: answer.balloon, spend: answer.spend };
    case 'discard':
      return { a: 'discard', cards: answer.cards };
    case 'skip':
      return { a: 'skip' };
    case 'card':
      return { a: 'cardTask', payload: answer.payload };
    default:
      answer satisfies never;
      throw new Error(`Unknown task answer ${JSON.stringify(answer)}`);
  }
}

export function actOf(move: Move): Act {
  switch (move.type) {
    case 'task':
      return actOfAnswer(move.answer);
    case 'cardMove':
      return { a: 'cardMove', card: move.card, kind: move.kind, payload: move.payload };
    case 'draw':
      return { a: 'draw' };
    case 'buy':
      return { a: 'buy', suit: move.suit };
    case 'build':
      return { a: 'build', card: move.card, payment: move.payment, coinWild: 0, barn: 0 };
    case 'hire':
      return { a: 'hire', workerId: move.workerId };
    case 'upgrade':
      return { a: 'upgrade', card: move.card };
    case 'grow':
      return { a: 'grow', building: move.building, payment: move.payment };
    case 'harvest':
      return { a: 'harvest', building: move.building };
    case 'deliver':
      return { a: 'deliver', tile: move.tile, spend: move.spend };
    case 'moveBalloon':
      return { a: 'balloon', balloon: move.balloon, spend: move.spend };
    case 'visit':
      return { a: 'visit', host: move.host, fee: move.fee, payoff: move.payoff };
    case 'workOwnWorker':
      return { a: 'workOwn', workerId: move.workerId };
    case 'pass':
      return { a: 'pass' };
    case 'endTurn':
      return { a: 'endTurn' };
    default:
      move satisfies never;
      throw new Error(`Unknown move ${JSON.stringify(move)}`);
  }
}

/** Total cards a spend map costs, across suits. */
export function spendSize(spend: Spend): number {
  let n = 0;
  for (const value of Object.values(spend)) n += value ?? 0;
  return n;
}
