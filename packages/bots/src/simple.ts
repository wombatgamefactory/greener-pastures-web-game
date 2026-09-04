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
 * `random` with Deliver forced whenever it is legal - including a Deliver
 * door's task answer, because `actOf` collapses both spellings. Genuinely
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
 *
 * ⭐ **THE START-OF-TURN WINDOWS MOVED TO THE TOP IN v31, AND THE OLD ORDER WAS
 * NOT MERELY WORSE, IT WAS UNREACHABLE.**
 *
 * Every previous version of this list put the main actions above the bonus slot
 * on the argument that a slot option must never displace a Deliver. That
 * argument assumed the slot survived the action. It does not: `bonusOpen` is
 * gated on `!actionSpent` and `meepleOpen` on that plus an unspent bonus, so
 * taking any main action THROWS BOTH WINDOWS AWAY. Measured on the first v31
 * build with the old order, over 12 whole games: greedy took **0 visits, 0 bonus
 * draws** and reached a meeple only on the turns it had nothing else to do.
 *
 * A baseline that cannot reach three of the thirteen move types is not a fixed
 * point, it is a hole in the smoke test - so the two windows go first, meeples
 * before the bonus because that is the order the rules play them and because
 * taking the bonus shuts the meeple phase.
 *
 * ⚠️ `visit` ahead of `bonusDraw` keeps the one judgement the deleted `market`
 * and `buy` lines carried: a solitaire option must never displace the slot while
 * a cross-table one is on offer. ⚠️ But the move type does NOT distinguish a
 * self-visit, so what this actually guarantees is only that the slot is spent on
 * SOME board - a greedy seat takes whichever visit the engine enumerated first,
 * its own included. That is a real blind spot in the baseline and greedy must
 * never be read for anything about risk 2. It is not in `BALANCE_PROFILES`, so
 * no arm is measured through it.
 */
export const GREEDY_PRIORITY: readonly MoveType[] = [
  'task',
  // DL-78 "Deliver is absolute" stays at the top, above the windows, and it has
  // to: a visit is legal on almost every turn, so a greedy bot that put the slot
  // first stopped delivering altogether and ran two of twelve smoke games to the
  // move ceiling. It costs the windows on the turns a delivery is available,
  // which is few - greedy delivers about ten times in five hundred moves.
  'deliver',
  'spendMeeple',
  'visit',
  'bonusDraw',
  // ⭐ COLLECT SITS BELOW `visit` AND BESIDE `bonusDraw`, which is the same
  // judgement in the meeple arm's currency: it is that arm's solitaire half, so
  // greedy takes it only when no visit is legal. Under the arm `bonusDraw` never
  // enumerates and under the shipped game `collect` never does, so exactly one
  // of these two lines is live in any given run and their order relative to each
  // other can never matter.
  //
  // ⚠️ The blind spot in the note above is SMALLER under the arm and not gone:
  // there is no self-visit to confuse a rival visit with (X5), so a greedy visit
  // is always cross-table - but the move type still cannot tell a wild spend from
  // a plain one, so greedy will burn pairs at random. It is not in
  // `BALANCE_PROFILES` and no arm is measured through it.
  'collect',
  'moveBalloon',
  'harvest',
  'build',
  'grow',
  'draw',
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
