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
  /** BUY AT MARKET (ticket 56): the bonus-slot coin sink. Top of `suit`'s deck into the BARN. */
  | { a: 'market'; suit: Suit }
  /**
   * `payment` is hand cards and `stacks` cards lifted off the seat's OWN
   * buildings (D7 The Versatile Shed). The engine holds
   * `payment.length + stacks.length === cardsNeeded`, so the two are ways of
   * paying ONE price and a term reading only their sum can never tell them
   * apart - which is what ticket 47 found `buildSpend` doing.
   *
   * `stacks` is a COUNT. The Dairy rebuild (2026-08-10) deleted the two legs
   * this used to carry - `coinWild` (coins as cards) and `barn` (barn cards in
   * the payment) - and replaced them with this one; unlike the barn leg, which
   * ticket 51 measured as dead (0.2% of 896 build groups offered one and no
   * chosen move ever spent one), a stack card is a REAL alternative to a hand
   * card, so it is charged as one. See `handSpend`.
   */
  | { a: 'build'; card: CardId; payment: readonly CardId[]; stacks: number }
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
  /** The Apiary Service: a deck top onto one of your buildings, never a hand card. */
  | { a: 'deckSow'; suit: Suit; onto: CardId }
  /** The Wheat and Vegetable Services' optional hand card into your own barn. */
  | { a: 'handToBarn'; card: CardId }
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
        stacks: (answer.stacks ?? []).length,
      };
    case 'deliver':
      return { a: 'deliver', tile: answer.tile, spend: answer.spend };
    case 'balloon':
      return { a: 'balloon', balloon: answer.balloon, spend: answer.spend };
    case 'deckSow':
      return { a: 'deckSow', suit: answer.suit, onto: answer.onto };
    case 'handToBarn':
      return { a: 'handToBarn', card: answer.card };
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
    case 'market':
      return { a: 'market', suit: move.suit };
    case 'build':
      return { a: 'build', card: move.card, payment: move.payment, stacks: 0 };
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
