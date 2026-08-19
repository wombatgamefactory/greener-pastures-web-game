/**
 * The handler-facing runtime slice: the entry points that run card behaviour.
 *
 * Each entry point follows apply()'s contract from ticket 04: clone the state,
 * mutate the draft through an Fx, drain the task queue, return {state, events}.
 * The full `newGame` / `legalMoves` / `apply` surface subsumes these when the
 * turn-flow and bulk card build land; these functions become apply's internal
 * branches, not a second API.
 */

import type { GameData, WorkerAction } from '@gp/data';

import { activationSurchargeOf, doVisit, doWorkOwn } from './actions.js';
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
 * ⛔ NOTHING SUIT-SPECIFIC LIVES HERE any more. This function is called by the
 * GROW action, by O13 The Grand Orchard and by A6, so anything wired in here
 * fires once per building grown rather than once per action - which is why the
 * Apiary Farmstead's draw is in `apiaryGrowBonus`, on the action branch, and
 * not in this function.
 */
export function doGrow(
  fx: Fx,
  seat: Seat,
  building: CardId,
  payment: CardId,
  mods: GrowMods = {},
): void {
  const p = player(fx.state, seat);
  const b = p.tableau.find((x) => x.card === building);
  if (!b) throw new Error(`Seat ${seat} has not built ${building}`);
  if (cardById(fx.data, building).slot === 'noticeboard') {
    throw new Error('The Notice Board is never a Grow target');
  }
  if (!canTakeCard(fx.data, b)) throw new Error(`${building} is full or has no stack`);
  const activationType = faceOf(fx.data, b).activationType;
  if (activationType === null) throw new Error(`${building} has no activation type`);
  if (activationType !== 'wild' && mods.anyCrop !== true) {
    const paidSuit = cardById(fx.data, payment).suit;
    if (paidSuit !== activationType) {
      throw new Error(`${building} needs a ${activationType} card, got ${paidSuit}`);
    }
  }
  // A8's £1 activation surcharge: checked before, paid after the card lands
  // (the reference's order), before the ability fires. Nothing in the catalogue
  // prints one since the Apiary rebuild; the branch stays, data-driven.
  const surcharge = activationSurchargeOf(fx.data, building);
  if (p.coins < surcharge) throw new Error(`${building} needs £${surcharge} to activate`);
  fx.placeOnBuilding(seat, { seat, card: building }, payment);
  if (surcharge > 0) fx.payCoins(seat, surcharge, `surcharge:${building}`);
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
  if (slot === 'noticeboard' || slot === 'service') {
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
 * The visit's Service payoff: place the fee card on the host's SERVICE (not
 * their Notice Board - the mode picks the building), take its action as the
 * visitor, mint the host their wage from the bank, and open the Helping Hand
 * gate.
 */
export function visitWork(
  data: GameData,
  state: GameState,
  visitor: Seat,
  host: Seat,
  workerId: string,
  fee: CardId,
): Applied {
  const draft = cloneState(state);
  const fx = new Fx(data, draft, visitor);
  doVisit(fx, visitor, host, [fee], { mode: 'worker', workerId: workerId as WorkerAction });
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/**
 * The bonus slot's other half: activate your own Service. Costs
 * `workers.ownerActivationCost` to the bank, places no card, earns nothing -
 * you never earn from your own farm.
 */
export function workOwnWorker(
  data: GameData,
  state: GameState,
  seat: Seat,
  workerId: string,
): Applied {
  const draft = cloneState(state);
  const fx = new Fx(data, draft, seat);
  doWorkOwn(fx, seat, workerId as WorkerAction);
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
  if (!offered.some((m) => sameShape(m, move))) {
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
  if (!legal.some((a) => sameShape(a, answer))) {
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
 * The four locked VP sources, each countable from public state: printed VP on
 * built cards, island receipts, end-game card formulas, and the coin pity
 * rate (a knob; null disables it).
 */
export interface ScoreBreakdown {
  printed: number;
  receipts: number;
  endgame: number;
  coinPity: number;
  total: number;
  /**
   * Which built card contributed what to `endgame`, in tableau order, including
   * the ones that scored 0.
   *
   * The other three sources are re-derivable from a `PlayerView` - receipts are
   * on the island, printed VP is on the cards in the tableau, coins are in
   * front of you - but an end-game formula runs against the true state, so a
   * screen that only got the total would be asking the player to take one of
   * the four numbers on trust. Ticket 27 needs this to show its working.
   */
  endgameCards: { card: CardId; vp: number }[];
  /**
   * The card whose own rate stands in for this seat's coin pity (the Bread
   * Hall), or null. Their `coinPity` is 0 and the coins are scored inside
   * `endgame` instead - which a screen has to say out loud, or the coins look
   * like they were forgotten.
   */
  coinPityReplacedBy: CardId | null;
}

export function gameEndScores(data: GameData, state: GameState): ScoreBreakdown[] {
  return state.players.map((p, seat) => {
    // The tableau alone. There used to be a second term here for D11's covered
    // pile - cards buried under a build-on-top, which were not buildings but
    // still scored their printed VP as a bare sum. D11 was retexted on
    // 19/08/2026 ("Build. Sow all the cards spent.") and the `covered` zone went
    // with it, so printed VP is once again exactly what is on the table.
    const printed = p.tableau.reduce((sum, b) => sum + faceOf(data, b).printedVp, 0);
    const receipts = p.receipts.reduce((sum, vp) => sum + vp, 0);
    const endgameCards = p.tableau.flatMap((b) => {
      const formula = handlerFor(b.card)?.gameEnd;
      return formula ? [{ card: b.card, vp: formula(data, state, seat) }] : [];
    });
    const endgame = endgameCards.reduce((sum, e) => sum + e.vp, 0);
    const divisor = data.rules.economy.coinPityDivisor;
    const coinPityReplacedBy =
      p.tableau.find((b) => handlerFor(b.card)?.replacesCoinPity)?.card ?? null;
    const coinPity =
      divisor === null || coinPityReplacedBy !== null ? 0 : Math.floor(p.coins / divisor);
    return {
      printed,
      receipts,
      endgame,
      coinPity,
      total: printed + receipts + endgame + coinPity,
      endgameCards,
      coinPityReplacedBy,
    };
  });
}

export interface GameScore {
  seats: ScoreBreakdown[];
  /** Seats best-first: VP, then coins remaining, then receipt count (DL-16's full chain), then seat order. */
  ranking: Seat[];
}

export function score(data: GameData, state: GameState): GameScore {
  const seats = gameEndScores(data, state);
  const ranking = state.players
    .map((_, seat) => seat)
    .sort((a, b) => {
      const sa = seats[a] as ScoreBreakdown;
      const sb = seats[b] as ScoreBreakdown;
      const pa = player(state, a);
      const pb = player(state, b);
      return (
        sb.total - sa.total ||
        pb.coins - pa.coins ||
        pb.receipts.length - pa.receipts.length ||
        a - b
      );
    });
  return { seats, ranking };
}

/** Structural equality for answers/moves; card-set fields compare as sets. */
export function sameShape(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
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
