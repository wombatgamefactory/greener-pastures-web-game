/**
 * The probe - "if I played this, what would visibly happen?"
 *
 * Ticket 40's answer to an evaluator that priced move LABELS and never
 * outcomes. A card's ability only ever fires on GROW, and every one of the 105
 * abilities scored an identical flat 2.5, so the bots could not tell The Bakery
 * with three full buildings from The Bakery with none.
 *
 * A probe applies a move on a throwaway clone (`apply` clones its input, so the
 * real game is untouched and the real rng never advances) and hands back the
 * events it produced, redacted for the probing seat. Where the effect stopped
 * on a choice, `next` carries that choice's answers and `step` walks into it, so
 * a whole task chain can be rolled out one level at a time.
 *
 * Two things are deliberate:
 *
 *   1. **It lives in the engine, not in @gp/bots.** A probe holds a GameState,
 *      and the whole point of @gp/bots is that nothing in it can (ticket 10's
 *      boundary, enforced three ways). The bots receive a `Prober` closure and
 *      never see what is inside it.
 *
 *   2. **`next` stops at a rival's task.** A cross-player task is part of the
 *      effect, but it is not the probing seat's choice to make, so the rollout
 *      ends there rather than deciding for someone else.
 *
 * A probe does NOT swallow errors. An engine bug reached speculatively is still
 * an engine bug, and ticket 30 was found precisely because a probe-like walk
 * threw loudly instead of averaging the crash away.
 */

import type { GameData } from '@gp/data';

import { apply, legalMoves } from './game.js';
import type { GameEvent, GameState, Move, Seat, Task } from './state.js';
import { redactEvents, redactTask } from './view.js';

/**
 * Applies allowed per decision, shared by a probe and every `step` beneath it.
 *
 * A rollout is greedy and depth-capped, but a pathological position (a task
 * whose answers each push another task) could still walk a long way. The budget
 * is the backstop: it is spent per `apply`, never refunded, and a probe that
 * finds it exhausted reports `truncated` rather than throwing.
 */
export interface ProbeBudget {
  spent: number;
  readonly limit: number;
}

/** Default ceiling per decision. Measured: a typical GROW rollout spends 2-6. */
export const PROBE_BUDGET = 96;

export function newProbeBudget(limit: number = PROBE_BUDGET): ProbeBudget {
  return { spent: 0, limit };
}

export interface Probe {
  /** What the move produced, redacted for the probing seat. Never raw ids the seat may not see. */
  readonly events: readonly GameEvent[];
  /**
   * The answers to the choice the effect stopped on, empty when it resolved.
   * Empty also when the pending task belongs to another seat, or when the
   * budget ran out - `truncated` tells the two apart.
   */
  readonly next: readonly Move[];
  /** True when the chain was cut by the budget rather than by finishing. */
  readonly truncated: boolean;
  /**
   * The task the effect stopped on, redacted for the probing seat, or null when
   * it resolved or the budget cut the chain. Set only when the task is the
   * probing seat's own, so it always pairs with a non-empty `next`.
   *
   * Ticket 50. A rollout that stops mid-effect can price what it walked and
   * nothing else, so an effect whose payoff arrives after the stop is worth zero
   * - which is what a "Draw N" is, at N+1 levels a piece. Handing back the task
   * lets a caller price the position it stopped in instead of walking further,
   * which is both more accurate and strictly cheaper in `apply`s.
   */
  readonly pending: Task | null;
  /** Walk into one of `next`. Shares this probe's budget. */
  step(move: Move): Probe;
}

export type Prober = (move: Move) => Probe;

const CUT: Probe = {
  events: [],
  next: [],
  truncated: true,
  pending: null,
  step: () => CUT,
};

function probeAt(data: GameData, state: GameState, seat: Seat, budget: ProbeBudget): Prober {
  return (move: Move): Probe => {
    if (budget.spent >= budget.limit) return CUT;
    if (state.phase !== 'playing') return CUT;
    budget.spent += 1;

    const applied = apply(data, state, move);
    const post = applied.state;
    const head = post.tasks[0];
    const mine = head !== undefined && head.pid === seat && post.phase === 'playing';

    return {
      events: redactEvents(applied.events, seat),
      next: mine ? legalMoves(data, post) : [],
      truncated: false,
      pending: mine && head !== undefined ? redactTask(head, seat) : null,
      step: probeAt(data, post, seat, budget),
    };
  };
}

/**
 * Build the probe closure a policy is handed for one decision.
 *
 * The budget is per decision by design: a decision with many probe-worthy moves
 * shares one allowance rather than multiplying it, so the cost of a wide
 * position is bounded rather than proportional.
 */
export function makeProber(
  data: GameData,
  state: GameState,
  seat: Seat,
  budget: ProbeBudget = newProbeBudget(),
): Prober {
  return probeAt(data, state, seat, budget);
}
