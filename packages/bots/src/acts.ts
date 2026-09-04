/**
 * What a move DOES, with the two spellings of the same act collapsed.
 *
 * The engine deliberately offers a Deliver twice - as the `deliver` MOVE and as
 * the `deliver` ANSWER to a door's Deliver task - because both go through one
 * enumerator (ticket 19). A scoring term that only knew about the move type
 * would value the door's delivery at zero, so every term reads an `Act`
 * instead: normalise once here, and "Deliver is absolute" holds wherever a
 * delivery appears.
 *
 * ⛔ FOUR ACTS LEFT WITH v31 (02/09/2026) AND ALL FOUR WERE BOUGHT WITH MONEY:
 * `buy` (GBP 1 for a blind deck top into hand), `market` (GBP 3 for a deck top
 * into the barn), `upgrade` (GBP 2 to flip a starter) and `workOwn` (activate
 * your own Service, paid to the bank). The `worker` task answer went with the
 * `chooseWorker` task, and `discard` went with the hand limit. Two arrive to
 * replace them - `bonusDraw` and `spendMeeple` - and the visit changes shape.
 *
 * ⭐ THE VISIT CARRIES `self`, AND THAT FLAG IS RISK 2 OF THE WHOLE PASS. In
 * v31 a seat may place its bonus card on its OWN Notice Board and take its own
 * suit's action, so the same act, the same currency and the same slot buy
 * either a cross-table visit or a solitaire one. Collapsing the two into one
 * undifferentiated `visit` act would leave the bots unable to prefer either and
 * the report unable to tell them apart - which is precisely the failure the
 * plan warns about, "a healthy hook while the table plays solitaire". So the
 * distinction is carried on the act, priced by two separate weights (`visit`
 * and `selfVisit`), and read once off `host === seat` rather than re-derived at
 * every call site.
 *
 * ## ⭐ THE MEEPLE-LOOP ARM (04/09/2026) - one new act, and one changed one
 *
 * `rules.turn.visitCurrency: 'meeple'` re-cuts the bonus slot: the free Draw 1
 * becomes COLLECT (a new act) and the visit stops costing a card and starts
 * costing a MEEPLE, or two of them as a wild. So the visit act grows two shapes
 * rather than splitting into two acts - `fee` goes nullable and `meeples`
 * arrives - and that is deliberate. **Everything about a visit except what pays
 * for it is unchanged**: the door still runs, `outcome` still prices it,
 * `bonusAction` still pays the action premium, and `host === seat` still
 * separates the interaction door from the solitaire one (it is simply always
 * false under the arm, by rule X5). Splitting the act would have forced every
 * one of those terms to learn about the arm to keep doing the thing it already
 * does.
 *
 * ⚠️ THE `'card'` GAME IS THE CONTROL AND MUST NOT MOVE. Under it `fee` is a
 * CardId and `meeples` is empty, so every arm-gated branch below reduces to the
 * pre-04/09/2026 arithmetic exactly - which is the property `bots.test.ts` and
 * the reference reports both depend on.
 */

import type { Suit } from '@gp/data';
import type { CardId, Move, Seat, TaskAnswer } from '@gp/engine';

type Spend = Partial<Record<Suit, number>>;

export type Act =
  /** The plain Draw action: `rules.turn.baseDraw`, see 2 keep 2 since v31. */
  | { a: 'draw' }
  /**
   * THE SOLITAIRE HALF OF THE BONUS SLOT: `rules.turn.bonusDraw` cards off the
   * top of any one deck in play, free. It is the yardstick every door has to
   * beat, and it is why the Orchard door prints Draw 3 rather than Draw 2.
   */
  | { a: 'bonusDraw' }
  /**
   * SPEND ONE MEEPLE: perform its colour's plain door action free, at the very
   * start of your turn, after which the meeple LEAVES THE GAME.
   *
   * `colour` is the whole act. What it is WORTH is what that door does in this
   * position, which is why it is on the probe path (`isProbed`) rather than
   * carrying a flat weight; what it COSTS is a stored action that never comes
   * back, which is `meepleSpend`.
   */
  | { a: 'spendMeeple'; colour: Suit }
  /**
   * `payment` is hand cards and `stacks` cards lifted off the seat's OWN
   * buildings (D7 The Versatile Shed). The engine holds
   * `payment.length + stacks.length === cardsNeeded`, so the two are ways of
   * paying ONE price and a term reading only their sum can never tell them
   * apart - which is what ticket 47 found `buildSpend` doing.
   *
   * `stacks` is a COUNT. Unlike the old barn leg, which ticket 51 measured as
   * dead (0.2% of 896 build groups offered one and no chosen move ever spent
   * one), a stack card is a REAL alternative to a hand card, so it is charged
   * as one.
   */
  | { a: 'build'; card: CardId; payment: readonly CardId[]; stacks: number }
  | { a: 'grow'; building: CardId; payment: CardId }
  | { a: 'harvest'; building: CardId }
  | { a: 'deliver'; tile: string; spend: Spend }
  | { a: 'balloon'; balloon: string; spend: Spend }
  /**
   * THE INTERACTION HALF OF THE BONUS SLOT: one card from hand onto a Notice
   * Board, then that board's suit action. `self` is `host === seat` - see the
   * file header; it is the flag the whole pass turns on.
   */
  | { a: 'visit'; host: Seat; fee: CardId | null; self: boolean; meeples: readonly Suit[] }
  /**
   * THE OTHER HALF OF THE BONUS SLOT UNDER THE MEEPLE-LOOP ARM
   * (`rules.turn.visitCurrency: 'meeple'`, Dean 04/09/2026): sweep every meeple
   * off your OWN Notice Board back into your supply, then Draw 1.
   *
   * It carries no fields, and it does not need any: WHICH meeples come back is
   * a fact about the seat's own board, not about the move, so the two halves of
   * its price are read off `Scratch` (`collectKeeps`, the meeples the cap will
   * actually let through) rather than off the act. There is exactly one Collect
   * on offer at a time - `collectOptions` returns a singleton - so there is
   * nothing here for a term to order either.
   *
   * ⭐ IT IS THE ARM'S SOLITAIRE LINE, and therefore the direct heir of
   * `bonusDraw`: an empty-board Collect IS a free Draw 1, and the bonus mix
   * counts it as such. What makes it more than that is the other half - the
   * stored actions a busy board hands back - which is why it is priced by two
   * terms and not one.
   */
  | { a: 'collect' }
  | { a: 'cardMove'; card: CardId; kind: string; payload: Record<string, unknown> }
  | { a: 'pass' }
  | { a: 'endTurn' }
  /** Task answers with no main-move twin. */
  | { a: 'deckPick'; suit: Suit }
  | { a: 'keep'; cards: readonly CardId[] }
  | { a: 'sow'; card: CardId; onto: CardId }
  /** Sow the top card of a DECK, never a hand card (A13, W7, a deck-sow door). */
  | { a: 'deckSow'; suit: Suit; onto: CardId }
  /**
   * GROW WITHOUT PLACING (A5 The Meadow Hive, A12 The Honey Hut): which of your
   * buildings to FIRE, with nothing paid and nothing placed.
   *
   * Its own act rather than `harvest`, even though the answer carries the same
   * one field, because the two are opposites: a harvest empties a stack and
   * this does not touch it. Priced by ROLLING IT OUT (`isProbed`), because the
   * value of an activation is entirely the value of what it fires - a flat
   * weight would have the bot either never taking A5 or always taking it.
   */
  | { a: 'activate'; building: CardId }
  /** An optional hand card into your own barn (the divert seam, W4's harvest). */
  | { a: 'handToBarn'; card: CardId }
  /**
   * The turn-boundary overflow: which cards go, when the hand is over
   * `rules.turn.handLimit`. Back with the limit on 02/09/2026.
   *
   * ⚠️ There is NO choice about whether to discard, only about which cards - so
   * this act must never be priced as a loss. `discardJunk` ranks the cards
   * instead, and `handSpendCost` is where the "a card over the limit is free"
   * ruling lives.
   */
  | { a: 'discard'; cards: readonly CardId[] }
  | { a: 'skip' }
  | { a: 'cardTask'; payload: Record<string, unknown> };

function actOfAnswer(answer: TaskAnswer): Act {
  switch (answer.kind) {
    case 'deck':
      return { a: 'deckPick', suit: answer.suit };
    case 'keep':
      return { a: 'keep', cards: answer.cards };
    // chooseBuilding's only `then` is 'harvest', so this IS a harvest.
    case 'building':
      return { a: 'harvest', building: answer.card };
    case 'activate':
      return { a: 'activate', building: answer.card };
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
    case 'bonusDraw':
      return { a: 'bonusDraw' };
    case 'spendMeeple':
      return { a: 'spendMeeple', colour: move.colour };
    case 'build':
      return { a: 'build', card: move.card, payment: move.payment, stacks: 0 };
    case 'grow':
      return { a: 'grow', building: move.building, payment: move.payment };
    case 'harvest':
      return { a: 'harvest', building: move.building };
    case 'deliver':
      return { a: 'deliver', tile: move.tile, spend: move.spend };
    case 'moveBalloon':
      return { a: 'balloon', balloon: move.balloon, spend: move.spend };
    case 'visit':
      // ⭐ `meeples` IS THE ARM'S CURRENCY MADE VISIBLE TO THE TERM TABLE, and
      // the empty array is the `'card'` game. One meeple for a plain visit, TWO
      // for a wild spend (R10) - and the COUNT is the whole reason it is carried
      // here rather than derived: a wild buys the same door for twice the stock,
      // so a term that could only see "a visit happened" would price the two
      // identically and the bots would burn pairs they should have held.
      return {
        a: 'visit',
        host: move.host,
        fee: move.fee,
        self: move.host === move.seat,
        meeples: move.meeples ?? [],
      };
    case 'collect':
      return { a: 'collect' };
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
