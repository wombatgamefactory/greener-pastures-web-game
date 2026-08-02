/**
 * The three bots that are not the scored evaluator.
 *
 * `random` is the fuzzer and the null hypothesis. `pulse` is `random` plus the
 * reference's DL-78 "Deliver is absolute" - the one override that makes a
 * wandering bot terminate, and the easy rung of the ladder. `greedy` is the
 * priority-order policy the engine's own full-game tests have used since ticket
 * 17, kept as the regression baseline.
 */

import type { Move, MoveType } from '@gp/engine';
import { rngInt } from '@gp/engine';

import { actOf } from './acts.js';
import type { Policy, PolicyContext } from './types.js';

function pickUniform(ctx: PolicyContext, moves: readonly Move[]): Move {
  if (moves.length === 0) throw new Error('asked to choose from no moves');
  return moves[rngInt(ctx.rng, moves.length)] as Move;
}

/**
 * Uniform over legal moves.
 *
 * Never offered to a human, and not a balance baseline either: it never
 * prioritises Deliver, so the island does not fill and roughly a third of 3-4p
 * games never end (measured in ticket 10, and worse since ticket 14's dearer
 * crates and ticket 29's level gate). Its job is to smoke out crashes and
 * illegal states.
 */
export const random: Policy = {
  id: 'random',
  choose: (ctx) => pickUniform(ctx, ctx.moves),
};

/**
 * `random` with Deliver forced whenever it is legal - including the Deliver
 * Worker's task answer, because `actOf` collapses both spellings. Genuinely
 * weak, genuinely coherent, and it finishes games.
 *
 * Balloon moves are Deliver ACTIONS but not island deliveries, so they are
 * deliberately not forced: they fill no crate and end no game.
 */
export const pulse: Policy = {
  id: 'pulse',
  choose(ctx) {
    const deliveries = ctx.moves.filter((move) => actOf(move).a === 'deliver');
    return pickUniform(ctx, deliveries.length > 0 ? deliveries : ctx.moves);
  },
};

/**
 * Priority order over move TYPE, ties broken uniformly.
 *
 * A near-copy lives in the engine's `game.test.ts`, which cannot import this
 * package (the engine may depend on nothing but @gp/data, and the bots depend
 * on the engine). The duplication is deliberate and the two are free to drift:
 * the engine's copy is scaffolding for a rules test, this one is the roster's
 * regression baseline.
 */
export const GREEDY_PRIORITY: readonly MoveType[] = [
  'task',
  'deliver',
  'moveBalloon',
  'harvest',
  'build',
  'hire',
  'upgrade',
  'grow',
  'draw',
  'visit',
  'workOwnWorker',
  'cardMove',
  'pass',
  'endTurn',
];

export const greedy: Policy = {
  id: 'greedy',
  choose(ctx) {
    for (const type of GREEDY_PRIORITY) {
      const of = ctx.moves.filter((move) => move.type === type);
      if (of.length > 0) return pickUniform(ctx, of);
    }
    throw new Error(`greedy: no move matched the priority list`);
  },
};
