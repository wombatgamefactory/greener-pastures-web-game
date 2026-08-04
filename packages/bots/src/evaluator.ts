/**
 * The scored evaluator: one code path, five bots (a weight table each).
 *
 * Nothing here is card-specific and nothing here reads GameState. Terms see an
 * `Act` and the per-decision `Scratch`; the table decides taste.
 */

import type { Move } from '@gp/engine';
import { rngInt } from '@gp/engine';

import { actOf } from './acts.js';
import { makeOutcomes } from './outcome.js';
import { makeScratch } from './scratch.js';
import { TERMS } from './terms.js';
import type { ExplainedMove, Policy, PolicyContext } from './types.js';
import type { WeightTable } from './weights.js';
import { weightsFor } from './weights.js';

/** Ties inside this band are broken by the policy's own rng, not by move order. */
const TIE_EPSILON = 1e-9;

/**
 * The scoring loop. One `Scratch` for the whole decision, one `Outcomes` (which
 * memoises probes across terms and across the explain pass), one `Act` per move.
 *
 * A term whose weight is zero is skipped before its feature runs, which is what
 * keeps the probe off the critical path for a profile that does not want it.
 */
function scoreAll(ctx: PolicyContext, weights: WeightTable): number[] {
  const scratch = makeScratch(ctx.data, ctx.view);
  const outcomes = makeOutcomes(scratch, weights, ctx.probe);
  const totals: number[] = [];
  for (const move of ctx.moves) {
    const act = actOf(move);
    let total = 0;
    for (const term of TERMS) {
      const weight = weights[term.name] ?? 0;
      if (weight === 0) continue;
      total += weight * term.feature(act, scratch, move, outcomes);
    }
    totals.push(total);
  }
  return totals;
}

function explainAll(ctx: PolicyContext, weights: WeightTable): ExplainedMove[] {
  const scratch = makeScratch(ctx.data, ctx.view);
  const outcomes = makeOutcomes(scratch, weights, ctx.probe);
  return ctx.moves.map((move) => {
    const act = actOf(move);
    const terms: Record<string, number> = {};
    let total = 0;
    for (const term of TERMS) {
      const weight = weights[term.name] ?? 0;
      if (weight === 0) continue;
      const value = weight * term.feature(act, scratch, move, outcomes);
      if (value === 0) continue;
      terms[term.name] = value;
      total += value;
    }
    return { move, total, terms };
  });
}

/**
 * Build one of the five scored bots.
 *
 * The rng is used only to break ties uniformly. That matters more than it
 * sounds: without it the bot would always take the first move `legalMoves`
 * enumerated, and the enumeration order is an artefact of the engine's code
 * layout rather than a play decision - it would quietly bias every balance
 * number toward whichever building happens to be scanned first.
 */
export function scoredPolicy(id: string, weights: WeightTable = weightsFor(id)): Policy {
  return {
    id,
    choose(ctx) {
      if (ctx.moves.length === 0) throw new Error(`${id}: asked to choose from no moves`);
      const totals = scoreAll(ctx, weights);
      let best = -Infinity;
      for (const total of totals) if (total > best) best = total;
      const top: Move[] = [];
      for (let i = 0; i < totals.length; i++) {
        if ((totals[i] as number) >= best - TIE_EPSILON) top.push(ctx.moves[i] as Move);
      }
      if (top.length === 1) return top[0] as Move;
      return top[rngInt(ctx.rng, top.length)] as Move;
    },
    explain(ctx) {
      return explainAll(ctx, weights).sort((a, b) => b.total - a.total);
    },
  };
}
