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

import { doVisit, doWorkOwn } from './actions.js';
import { Fx } from './fx.js';
import type { FxAudit } from './fx.js';
import { handlerFor } from './handlers/registry.js';
import type { CardMove } from './handlers/types.js';
import { canTakeCard, cardById, faceOf, player } from './query.js';
import type { CardId, GameEvent, GameState, Seat, Task, TaskAnswer } from './state.js';
import { drainTasks, resolveTask, taskAnswers } from './tasks.js';

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

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clonePlain) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clonePlain(v);
    return out as T;
  }
  return value;
}

/**
 * GROW: activate one of your own non-full buildings by paying one matching
 * card from hand into its stack, then gain its ability. "Matching" follows the
 * printed activation type: a suit means that suit, 'wild' means any card.
 * Owner-only by construction, and never the Notice Board (porting guard).
 * Lives here rather than in actions.ts because it dispatches into the handler
 * registry, which actions.ts must not import (the Helping Hand imports
 * actions.ts for workerActionLegal).
 */
export function doGrow(fx: Fx, seat: Seat, building: CardId, payment: CardId): void {
  const b = player(fx.state, seat).tableau.find((x) => x.card === building);
  if (!b) throw new Error(`Seat ${seat} has not built ${building}`);
  if (cardById(fx.data, building).slot === 'noticeboard') {
    throw new Error('The Notice Board is never a Grow target');
  }
  if (!canTakeCard(fx.data, b)) throw new Error(`${building} is full or has no stack`);
  const activationType = faceOf(fx.data, b).activationType;
  if (activationType === null) throw new Error(`${building} has no activation type`);
  if (activationType !== 'wild') {
    const paidSuit = cardById(fx.data, payment).suit;
    if (paidSuit !== activationType) {
      throw new Error(`${building} needs a ${activationType} card, got ${paidSuit}`);
    }
  }
  fx.placeOnBuilding(seat, { seat, card: building }, payment);
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
 * The visit's worker payoff: place the fee card on the host's Notice Board,
 * work one of the host's Hired Workers as the visitor (meeple advances, the
 * bank pays the host the wage), and open the Helping Hand gate.
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
  doVisit(fx, visitor, host, fee, { mode: 'worker', workerId: workerId as WorkerAction });
  drainTasks(data, draft);
  return { state: draft, events: fx.events, audit: fx.audit };
}

/**
 * The bonus slot's other half: work your own Hired Worker. Free, the meeple
 * advances, no wage - you never earn from your own farm.
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
  const done = resolveTask(fx, draft.tasks[0] as Task, answer);
  if (done) draft.tasks.shift();
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
}

export function gameEndScores(data: GameData, state: GameState): ScoreBreakdown[] {
  return state.players.map((p, seat) => {
    const printed = p.tableau.reduce((sum, b) => sum + faceOf(data, b).printedVp, 0);
    const receipts = p.receipts.reduce((sum, vp) => sum + vp, 0);
    const endgame = p.tableau.reduce(
      (sum, b) => sum + (handlerFor(b.card)?.gameEnd?.(data, state, seat) ?? 0),
      0,
    );
    const divisor = data.rules.economy.coinPityDivisor;
    const coinPity = divisor === null ? 0 : Math.floor(p.coins / divisor);
    return { printed, receipts, endgame, coinPity, total: printed + receipts + endgame + coinPity };
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
