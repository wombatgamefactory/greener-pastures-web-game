/**
 * The Policy interface, exactly as wayfinder ticket 10 specced it.
 *
 * The load-bearing line is what is NOT here: a policy has no field for
 * `GameState`. It sees the hidden-information view of the seat to move and
 * nothing else, so a balance number can never be contaminated by a bot that
 * knows the deck order. That is enforced three ways - this interface, the
 * eslint boundary on `packages/bots/**`, and the source probe in @gp/sim.
 */

import type { GameData } from '@gp/data';
import type { Move, PlayerView, Prober, RngState } from '@gp/engine';

export interface PolicyContext {
  /** All public: printed faces, costs, knobs. Overlay-applied by the caller. */
  readonly data: GameData;
  /** The hidden-information view of the seat to move. Built ONCE per decision by the driver. */
  readonly view: PlayerView;
  /** Exactly what legalMoves offered, unfiltered and unredacted (view-safe by construction). */
  readonly moves: Move[];
  /**
   * "If I played this, what would visibly happen?" (ticket 40).
   *
   * A closure built by the caller over the GameState this package may not see,
   * returning the events a move would produce - redacted for this seat - and
   * the choice it would stop on. It is how a bot prices a card's ability in the
   * position it is actually in, rather than at a flat constant.
   *
   * Required rather than optional on purpose: absent, GROW silently returns to
   * being worth 2.5 whatever it does, which is the bug this ticket exists to
   * fix. A missing probe should fail a typecheck, not a balance report.
   */
  readonly probe: Prober;
  /**
   * This policy's own stream, seeded from the game seat and carried across the
   * game. A policy may never touch `state.rng`: reading it would let a bot's
   * choices perturb the shuffles and identical seeds would stop reproducing.
   */
  readonly rng: RngState;
}

/** One move's score, broken down by the terms that produced it. Powers `--explain`. */
export interface ExplainedMove {
  move: Move;
  total: number;
  /** Term name -> its contribution (weight * feature). Zero contributions are omitted. */
  terms: Record<string, number>;
}

export interface Policy {
  readonly id: string;
  choose(ctx: PolicyContext): Move;
  /** Term-by-term breakdown, best first. Only the scored evaluator has one. */
  explain?(ctx: PolicyContext): ExplainedMove[];
}
