/**
 * The handler-facing runtime slice: the entry points that run card behaviour.
 *
 * Each entry point follows apply()'s contract from ticket 04: clone the state,
 * mutate the draft through an Fx, drain the task queue, return {state, events}.
 * The full `newGame` / `legalMoves` / `apply` surface subsumes these when the
 * turn-flow and bulk card build land; these functions become apply's internal
 * branches, not a second API.
 */

import type { GameData, Suit } from '@gp/data';

import { assertPlacementMatches, doVisit, meepleAsCard } from './actions.js';
import { clonePlain } from './clone.js';
import { Fx } from './fx.js';
import type { FxAudit } from './fx.js';
import { handlerFor } from './handlers/registry.js';
import type { CardMove } from './handlers/types.js';
import { canTakeCard, cardById, faceOf, player } from './query.js';
import type { CardId, GameEvent, GameState, Seat, Task, TaskAnswer } from './state.js';
import { drainTasks, popTask, resolveTask, taskAnswers } from './tasks.js';

export interface Applied {
  state: GameState;
  events: GameEvent[];
  /** What the effect's primitives did - the difficulty flags are verified against this. */
  audit: FxAudit;
}

/** Plain-data clone. GameState is JSON by construction, so this is total. */
export function cloneState(state: GameState): GameState {
  return clonePlain(state);
}

/** What granted this GROW, when it was not the plain action. */
export interface GrowMods {
  /**
   * A6 The Garden Hive: "GROW another of your buildings with a card of any
   * crop." The crop waiver used to be the Apiary Farmstead's base power, live
   * from turn 1 for every Apiary seat, which Dean ruled "trivialises the suit"
   * (2026-08-11). It survives only here, on one card that pays for it.
   */
  anyCrop?: boolean;
}

/**
 * GROW: activate one of your own non-full buildings by paying one matching
 * card from hand into its stack, then gain its ability. "Matching" follows the
 * printed activation type: a suit means that suit, 'wild' means any card.
 * Owner-only by construction, and never the Notice Board (porting guard).
 * Lives here rather than in actions.ts because it dispatches into the handler
 * registry, which actions.ts must not import (the Helping Hand imports
 * actions.ts for workerActionLegal).
 *
 * ⛔ NOTHING SUIT-SPECIFIC LIVES HERE. This function is called by the GROW
 * action, by O13 The Grand Orchard and by A6, so anything wired in here fires
 * once per BUILDING grown rather than once per action - which is why the Apiary
 * Farmstead's draw lived on the action branch in game.ts and never in here. That
 * card is gone (v31) but the constraint is permanent: an ACTION-scoped effect
 * belongs on the action branch, or a card that grows three buildings fires it
 * three times.
 */
export function doGrow(
  fx: Fx,
  seat: Seat,
  building: CardId,
  payment: CardId | null,
  mods: GrowMods = {},
  /**
   * R15: the meeple that paid instead of a card, or the two spent as a wild
   * pair (R10). Mutually exclusive with `payment`.
   */
  meeples: readonly Suit[] = [],
  /** R17: where the paid meeple(s) land, by seat, and the toll they owed. */
  placement: {
    placements?: Partial<Record<Suit, number>>[];
    paymentToll?: Partial<Record<Suit, number>>;
  } = {},
): void {
  const p = player(fx.state, seat);
  const b = p.tableau.find((x) => x.card === building);
  if (!b) throw new Error(`Seat ${seat} has not built ${building}`);
  if (cardById(fx.data, building).slot === 'noticeboard') {
    throw new Error('The Notice Board is never a Grow target');
  }
  const byMeeple = meeples.length > 0;
  if (byMeeple && payment !== null) {
    throw new Error('A GROW is paid with one card or with meeples, never both');
  }
  if (!byMeeple && payment === null) throw new Error(`${building} was not paid for`);
  if (byMeeple && !meepleAsCard(fx.data)) {
    throw new Error('A meeple pays for a GROW only under rules.turn.meepleAsCard');
  }
  // ⭐ A FULL BUILDING IS A LEGAL MEEPLE-PAID GROW TARGET (R15, Dean
  // 04/09/2026 evening). The gate exists because a card has to go somewhere;
  // a meeple goes to the box, so nothing is placed, the threshold is never
  // touched and the building is left exactly as it was. It is a priced clog
  // bypass, on purpose.
  const atThreshold = !canTakeCard(fx.data, b);
  if (atThreshold && !byMeeple) throw new Error(`${building} is full or has no stack`);
  const activationType = faceOf(fx.data, b).activationType;
  if (activationType === null) throw new Error(`${building} has no activation type`);
  if (activationType !== 'wild' && mods.anyCrop !== true) {
    if (byMeeple) {
      // One meeple must BE the colour; two are a wild pair and may be anything,
      // including two of one colour where the cap allows it.
      if (meeples.length === 1 && meeples[0] !== activationType) {
        throw new Error(`${building} needs a ${activationType} meeple, got ${meeples[0]}`);
      }
    } else {
      const paidSuit = cardById(fx.data, payment as CardId).suit;
      if (paidSuit !== activationType) {
        throw new Error(`${building} needs a ${activationType} card, got ${paidSuit}`);
      }
    }
  }
  if (byMeeple) {
    if (meeples.length > 2) throw new Error('A GROW is paid with one meeple, or two as a wild');
    const counts: Partial<Record<Suit, number>> = {};
    for (const m of meeples) counts[m] = (counts[m] ?? 0) + 1;
    for (const [colour, n] of Object.entries(counts) as [Suit, number][]) {
      if (p.meeples[colour] < n) throw new Error(`Seat ${seat} has no ${colour} meeple`);
    }
    const wildPairs = meeples.length === 2 ? 1 : 0;
    if (placement.placements === undefined) {
      fx.payMeeplesAsCards(seat, counts, 'activation', { wildPairs, atThreshold });
    } else {
      // R17: the same payment, landing on a neighbour's board instead of the
      // box. `assertPlacementMatches` recomputes the toll off the live boards,
      // so an under-declared toll is a free placement and is refused here.
      assertPlacementMatches(fx.data, fx.state, seat, counts, placement);
      fx.placeMeeplesAsCards(seat, placement.placements, placement.paymentToll ?? {}, 'activation', {
        wildPairs,
        atThreshold,
      });
    }
    markFired(fx, building);
    handlerFor(building)?.activate?.(fx, { seat, card: building });
    return;
  }
  // The GBP 1 activation surcharge (A8 The Wild Hive) was checked here and paid
  // after the card landed, before the ability fired. It went with the currency
  // (v31) and no card in the catalogue carries the trigger; see the tombstone on
  // `activationSurchargeOf` in actions.ts for the pattern, which is the right
  // one if a toll ever returns priced in cards.
  fx.placeOnBuilding(seat, { seat, card: building }, payment as CardId);
  markFired(fx, building);
  handlerFor(building)?.activate?.(fx, { seat, card: building });
}

/**
 * Record that a card's printed ability has fired this turn - the shared half of
 * the recursion guard (`turn.firedThisTurn`), and THE ONE WRITER of that list.
 * Both routes into a building's text go through it: a real GROW and an
 * activation with no placement.
 *
 * Exported since the Dairy rebalance (2026-08-12) because the guard is no longer
 * only about buildings. D16 The Ledger is a POWER card with no activation type,
 * so it is never grown and never activated, and it marks itself from its own
 * `afterBuild` listener to get "Once per turn." Any future card that has to
 * self-mark calls this rather than pushing the array, so the dedupe stays in one
 * place. ✅ Safe for a Power card: `growOptions` and `activateTargets` filter on
 * this list but also require `activationType !== null`, so an entry for a card
 * that was never a GROW target removes nothing.
 */
export function markFired(fx: Fx, building: CardId): void {
  const fired = fx.state.turn.firedThisTurn;
  if (!fired.includes(building)) fired.push(building);
}

/**
 * GROW WITHOUT PLACING (A5 The Meadow Hive, A12 The Honey Hut): fire a
 * building's printed ability with no card paid, no crop matched, no stack
 * advanced and no surcharge. The Apiary suit's signature, and the reason a
 * clogged farm still works for it - a FULL building is a legal target here,
 * because the only reason a full building cannot be grown is that no card may
 * be placed on it.
 *
 * It does exactly one thing beyond the dispatch: it marks the card fired. In
 * particular it does NOT fire `afterPlacement` (nothing was placed), does not
 * touch the stack, and does NOT trigger the Apiary Farmstead's draw, which
 * modifies the GROW ACTION and not card text that says GROW.
 */
export function activateOnly(fx: Fx, seat: Seat, building: CardId): void {
  const b = player(fx.state, seat).tableau.find((x) => x.card === building);
  if (!b) throw new Error(`Seat ${seat} has not built ${building}`);
  if (faceOf(fx.data, b).activationType === null) {
    throw new Error(`${building} has no printed activated ability`);
  }
  const slot = cardById(fx.data, building).slot;
  // Change 6: 'service' is gone as a slot; the Notice Board is the door and
  // is still never a Grow target.
  if (slot === 'noticeboard') {
    throw new Error(`${building} is never an activation target`);
  }
  if (fx.state.turn.firedThisTurn.includes(building)) {
    throw new Error(`${building} has already fired this turn`);
  }
  markFired(fx, building);
  handlerFor(building)?.activate?.(fx, { seat, card: building });
}

/** GROW as a bare runtime slice (no action bookkeeping). apply()'s grow branch spends the action first. */
export function growBuilding(
  data: GameData,
  state: GameState,
  seat: Seat,
  building: CardId,
  payment: CardId,
): Applied {
  const draft = cloneState(state);
  const fx = new Fx(data, draft, seat);
  doGrow(fx, seat, building, payment);
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/**
 * A VISIT as a bare runtime slice: place the fee card on the host's Notice Board
 * and take that board's suit action as the visitor. `host` may be `visitor`'s
 * own seat when `rules.turn.selfVisitAllowed`.
 *
 * ⛔ `workOwnWorker` stood beside this and is GONE (v31). It was the bonus
 * slot's other half - activate your OWN Service, paid to the bank, placing no
 * card - and it enforced the standing law that you never earn from your own
 * farm. The self-visit replaces it and is a strictly harder deal: the card lands
 * on your board and counts toward your own threshold.
 */
export function visitWork(
  data: GameData,
  state: GameState,
  visitor: Seat,
  host: Seat,
  fee: CardId,
): Applied {
  const draft = cloneState(state);
  const fx = new Fx(data, draft, visitor);
  doVisit(fx, visitor, host, { fee });
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/** Standing moves offered by a seat's built cards - legalMoves' card-move branch. */
export function standingMoves(data: GameData, state: GameState, seat: Seat): CardMove[] {
  return player(state, seat).tableau.flatMap((b) => {
    const handler = handlerFor(b.card);
    if (!handler?.moves) return [];
    return handler.moves(data, state, { seat, card: b.card });
  });
}

/** Apply a standing card move. Re-validates against the enumerator - apply accepts exactly what legalMoves offers. */
export function applyCardMove(data: GameData, state: GameState, move: CardMove): Applied {
  const offered = standingMoves(data, state, move.seat);
  const key = shapeKey(move);
  if (!offered.some((m) => shapeKey(m) === key)) {
    throw new Error(`Move not offered: ${move.card}/${move.kind}`);
  }
  const draft = cloneState(state);
  const fx = new Fx(data, draft, move.seat);
  const handler = handlerFor(move.card);
  if (!handler?.applyMove) throw new Error(`${move.card} has no applyMove`);
  handler.applyMove(fx, { seat: move.seat, card: move.card }, move);
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/** Answer the head task. Re-validates the answer against the task's own enumerator. */
export function answerTask(data: GameData, state: GameState, answer: TaskAnswer): Applied {
  const head = state.tasks[0];
  if (!head) throw new Error('No pending task');
  const legal = taskAnswers(data, state, head);
  const key = shapeKey(answer);
  if (!legal.some((a) => shapeKey(a) === key)) {
    throw new Error(`Illegal answer to ${head.t}: ${JSON.stringify(answer)}`);
  }
  const draft = cloneState(state);
  const fx = new Fx(data, draft, head.pid);
  const resolving = draft.tasks[0] as Task;
  const done = resolveTask(fx, resolving, answer);
  if (done) popTask(draft, resolving);
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/** Legal answers to the current head task (empty when no task is pending). */
export function pendingAnswers(data: GameData, state: GameState): TaskAnswer[] {
  const head = state.tasks[0];
  return head ? taskAnswers(data, state, head) : [];
}

/**
 * THE THREE VP SOURCES (v31), each countable from public state: printed VP on
 * built cards, island receipts, and end-game card formulas.
 *
 * ⛔ THE COIN PITY RATE IS GONE, and it went twice. It was deleted as a RULE on
 * 2026-08-03 - in a coin-rich game a pity rate quietly rewards not spending -
 * and survived as a null knob (`economy.coinPityDivisor`) plus a
 * `replacesCoinPity` handler flag for the Bread Hall, whose own "1 VP for every
 * £2" stood in for it so the two lines reconciled on a scoring screen. v31
 * deletes the currency, so both go.
 *
 * ⭐ THE FARMSTEAD'S NEW END-GAME VP NEEDS NO MACHINERY HERE. All five print
 * "Game end: 1 VP for each CROP card you have built", and `endgameCards` below
 * already walks every built card's `gameEnd` formula, so five Farmstead handlers
 * are the whole implementation. That seam is deliberately untouched.
 */
export interface ScoreBreakdown {
  printed: number;
  receipts: number;
  endgame: number;
  total: number;
  /**
   * Which built card contributed what to `endgame`, in tableau order, including
   * the ones that scored 0.
   *
   * The other two sources are re-derivable from a `PlayerView` - receipts are on
   * the island, printed VP is on the cards in the tableau - but an end-game
   * formula runs against the true state, so a screen that only got the total
   * would be asking the player to take one of the three numbers on trust. Ticket
   * 27 needs this to show its working, and it matters more in v31: the Farmstead
   * is now an end-game card, so every seat has at least one line here.
   */
  endgameCards: { card: CardId; vp: number }[];
}

export function gameEndScores(data: GameData, state: GameState): ScoreBreakdown[] {
  return state.players.map((p, seat) => {
    // The tableau alone. There used to be a second term here for D11's covered
    // pile - cards buried under a build-on-top, which were not buildings but
    // still scored their printed VP as a bare sum. D11 was retexted on
    // 19/08/2026 ("Build. Sow all the cards spent.") and the `covered` zone went
    // with it, so printed VP is once again exactly what is on the table. All
    // fifteen starters print 0 (v31), so a seat's printed line is its deck cards.
    const printed = p.tableau.reduce((sum, b) => sum + faceOf(data, b).printedVp, 0);
    const receipts = p.receipts.reduce((sum, vp) => sum + vp, 0);
    const endgameCards = p.tableau.flatMap((b) => {
      const formula = handlerFor(b.card)?.gameEnd;
      return formula ? [{ card: b.card, vp: formula(data, state, seat) }] : [];
    });
    const endgame = endgameCards.reduce((sum, e) => sum + e.vp, 0);
    return {
      printed,
      receipts,
      endgame,
      total: printed + receipts + endgame,
      endgameCards,
    };
  });
}

export interface GameScore {
  seats: ScoreBreakdown[];
  /**
   * Seats best-first: total VP, then CARDS IN HAND PLUS BARN, then receipt
   * count, then seat order.
   *
   * ⭐ THE SECOND LINK CHANGED IN v31 (docs/design-changes-v31 §1.3). It was
   * coins remaining, from DL-16's chain; with no currency the tie-break is "most
   * cards in hand and barn combined", which is the only stock a player still
   * ends the game holding. It reads a raw count and never the barn's colours,
   * deliberately - the colour puzzle belongs to the island, not to the tie-break.
   *
   * Deliberately NOT unspent meeples. A meeple is a stored action, so paying VP
   * for holding one would reward not spending it, which is precisely the
   * mistake the coin pity rate was deleted for on 2026-08-03. Unspent meeples
   * are a dead-component metric, not a score.
   */
  ranking: Seat[];
}

export function score(data: GameData, state: GameState): GameScore {
  const seats = gameEndScores(data, state);
  const stock = (seat: Seat): number => {
    const p = player(state, seat);
    return p.hand.length + p.barn.length;
  };
  const ranking = state.players
    .map((_, seat) => seat)
    .sort((a, b) => {
      const sa = seats[a] as ScoreBreakdown;
      const sb = seats[b] as ScoreBreakdown;
      return (
        sb.total - sa.total ||
        stock(b) - stock(a) ||
        player(state, b).receipts.length - player(state, a).receipts.length ||
        a - b
      );
    });
  return { seats, ranking };
}

/** Structural equality for answers/moves; card-set fields compare as sets. */
export function sameShape(a: unknown, b: unknown): boolean {
  return shapeKey(a) === shapeKey(b);
}

/**
 * The canonical form as a comparable string - `sameShape`'s two halves, split
 * apart so a caller scanning a LIST can compute the needle once.
 *
 * ⭐ THAT SPLIT IS THE WHOLE REASON THIS IS EXPORTED (04/09/2026). Every
 * re-validation in the engine reads `legal.some((x) => sameShape(x, answer))`,
 * which canonicalises and stringifies `answer` again for every candidate it
 * walks; a CPU profile put `sameShape` plus `canonical` at ~9% of a whole game,
 * and the probe applies moves speculatively so it is paid on the bots' critical
 * path as well. Hoisting the needle's key out of the loop is the same
 * comparison, the same string on both sides, and the same verdict - it simply
 * stops computing one of them N times.
 */
export function shapeKey(value: unknown): string {
  return JSON.stringify(canonical(value));
}

const SET_KEYS = new Set(['cards', 'payment']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      out[k] = SET_KEYS.has(k) && Array.isArray(v) ? [...(v as unknown[])].sort() : canonical(v);
    }
    return out;
  }
  return value;
}
