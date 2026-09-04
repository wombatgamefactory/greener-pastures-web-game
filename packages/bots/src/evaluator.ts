/**
 * The scored evaluator: one code path, six bots (a weight table each).
 *
 * Nothing here is card-specific and nothing here reads GameState. Terms see an
 * `Act` and the per-decision `Scratch`; the table decides taste.
 */

import type { Move, MoveType } from '@gp/engine';
import { rngInt } from '@gp/engine';

import { actOf } from './acts.js';
import { narrowMoves } from './narrow.js';
import { makeOutcomes } from './outcome.js';
import { makeScratch } from './scratch.js';
import { TERMS } from './terms.js';
import type { ExplainedMove, Policy, PolicyContext } from './types.js';
import type { WeightTable } from './weights.js';
import { weightsFor } from './weights.js';

/** Ties inside this band are broken by the policy's own rng, not by move order. */
const TIE_EPSILON = 1e-9;

/**
 * The two start-of-turn windows, in the order the rules play them.
 *
 * ⭐ WHY THEY NEED SPECIAL HANDLING AT ALL - v31, and this is a structural fix
 * rather than a taste. A term table picks the single highest-scoring move, which
 * is the right shape for options that compete for one resource. **These do not
 * compete: they SHUT.**
 *
 *   - A meeple is spent before anything else and consumes neither the bonus slot
 *     nor the action, so spending one leaves every other move on the menu. The
 *     moment the bot takes a bonus option or an action, `meepleOpen` goes false
 *     and the meeple is stranded until next turn.
 *   - The bonus slot (`bonusTiming`) is open only while `!actionSpent` under
 *     taking the main action throws it away.
 *
 * An argmax cannot see that. Measured on the first v31 build, before this
 * existed: over 12 whole games at 2 and 3 seats the reference bot spent **0
 * meeples out of 11 gained** and left the bonus slot unspent on **every turn of
 * every game**, because a delivery scores 18 and a free Draw 1 scores 1.2 - so
 * the delivery won, and closed both windows on its way past. The report that
 * came out of that would have read "the meeple mechanism is dead and nobody
 * uses the bonus slot", which is a statement about this function and not about
 * the rules.
 *
 * So the windows are taken FIRST, and the only judgement left is whether the
 * option is worth taking at all - which is still the weight table's call, at its
 * own zero. A meeple whose door does less than the meeple is worth scores
 * negative (`meepleSpend` is the reserve price) and is not taken; a visit that
 * is not worth its card scores negative and is not taken; the free Draw 1 scores
 * +1.2 and always is, which is correct, because a card for nothing is strictly
 * better than nothing.
 *
 * ⚠️ **IT IS DELIBERATELY BLIND TO WHICH OPTION IT PICKS.** Stage 2 ranks
 * `visit` and `bonusDraw` against each other by their ordinary scores, and a
 * self-visit and a neighbour visit are both plain `visit` moves here - so risk 2
 * is decided by `outcome`, `clogOwnBoard` and the profile's `visit` / `selfVisit`
 * weights, exactly as it would be in an argmax. This function changes WHEN the
 * slot is spent, never on WHAT.
 *
 * ⚠️ **IT MAKES "SLOT UNSPENT" A NEAR-ZERO METRIC, and the plan should be read
 * knowing that.** The v31 watch-list wants the unspent share tallied because "a
 * bonus you must commit to before you act is a bonus that gets forgotten" - but
 * forgetting is a human failure and a bot cannot model it. What the sim will
 * measure here is the RATIONAL floor: the slot goes unspent only when no option
 * scores above zero, which in practice means every deck is empty or every board
 * is clogged with an empty hand. A low unspent share in the report is therefore
 * not evidence that the restriction is harmless at a table.
 */
const MEEPLE_WINDOW: readonly MoveType[] = ['spendMeeple'];
const BONUS_WINDOW: readonly MoveType[] = ['visit', 'bonusDraw'];

/**
 * The scoring loop. One `Scratch` for the whole decision, one `Outcomes` (which
 * memoises probes across terms and across the explain pass), one `Act` per move.
 *
 * A term whose weight is zero is skipped before its feature runs, which is what
 * keeps the probe off the critical path for a profile that does not want it.
 */
function scoreAll(ctx: PolicyContext, moves: readonly Move[], weights: WeightTable): number[] {
  const scratch = makeScratch(ctx.data, ctx.view);
  const outcomes = makeOutcomes(scratch, weights, ctx.probe);
  const totals: number[] = [];
  for (const move of moves) {
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
  // ⚠️ DELIBERATELY NOT NARROWED, unlike `choose`. `--explain` is read by a
  // human asking "why did it not do the thing I would have done", and the
  // answer has to be available for moves the bot collapsed away as well as for
  // the ones it ranked. It costs nothing to keep: explain runs once, by hand,
  // never in a balance run. The collapse keeps the argmax (see narrow.ts), so
  // the move at the top of this list is still the move `choose` would take.
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
 * The best-scoring move among `indices`, ties broken by the policy's own rng.
 *
 * The rng matters more than it sounds: without it the bot would always take the
 * first move `legalMoves` enumerated, and the enumeration order is an artefact
 * of the engine's code layout rather than a play decision - it would quietly
 * bias every balance number toward whichever building happens to be scanned
 * first.
 */
function bestOf(
  ctx: PolicyContext,
  moves: readonly Move[],
  totals: readonly number[],
  indices: readonly number[],
): Move | null {
  if (indices.length === 0) return null;
  let best = -Infinity;
  for (const i of indices) {
    const total = totals[i] as number;
    if (total > best) best = total;
  }
  const top: Move[] = [];
  for (const i of indices) {
    if ((totals[i] as number) >= best - TIE_EPSILON) top.push(moves[i] as Move);
  }
  if (top.length === 1) return top[0] as Move;
  return top[rngInt(ctx.rng, top.length)] as Move;
}

/** Indices of moves of these types that score above zero. */
function worthwhile(
  moves: readonly Move[],
  totals: readonly number[],
  types: readonly MoveType[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i] as Move;
    if (!types.includes(move.type)) continue;
    if ((totals[i] as number) <= 0) continue;
    out.push(i);
  }
  return out;
}

/**
 * Take a closing window before it closes - see the note on `MEEPLE_WINDOW`.
 * Returns null when neither window has anything worth taking, and the caller
 * falls through to the ordinary argmax.
 */
function windowedPick(
  ctx: PolicyContext,
  moves: readonly Move[],
  totals: readonly number[],
): Move | null {
  const meeple = bestOf(ctx, moves, totals, worthwhile(moves, totals, MEEPLE_WINDOW));
  if (meeple !== null) return meeple;
  // Reading the knob here rather than assuming is what keeps the arms differing
  // by the RULE and not by the bot.
  //
  //   'any'   the slot never closes, so there is no window to miss and the
  //           plain argmax is correct.
  //   'start' the slot shuts the moment the action is spent - the window this
  //           function was written for.
  //   'end'   THE SHIPPED RULE (03/09/2026). The slot OPENS when the action is
  //           spent and then stays open to the turn boundary, so again there is
  //           no closing window to protect: `turnflow` holds the turn open for
  //           an unspent bonus and the argmax gets its ordinary say.
  //
  // ⭐ The window exists to stop a big main action closing a slot on its way
  // past. Under 'end' a main action OPENS the slot instead, so the whole failure
  // mode this function was built for cannot occur - which is why 'end' returns
  // null rather than getting a window of its own.
  const timing = ctx.data.rules.turn.bonusTiming;
  if (timing !== 'start') return null;
  if (ctx.view.turn.actionSpent) return null;
  return bestOf(ctx, moves, totals, worthwhile(moves, totals, BONUS_WINDOW));
}

/** Build one of the scored bots. */
export function scoredPolicy(id: string, weights: WeightTable = weightsFor(id)): Policy {
  return {
    id,
    choose(ctx) {
      if (ctx.moves.length === 0) throw new Error(`${id}: asked to choose from no moves`);
      // ⭐ THE OPTION COLLAPSE (03/09/2026). Rules-equivalent build payments and
      // overflow discards are folded to one representative each BEFORE the term
      // table runs - see narrow.ts for why the argmax is provably unchanged and
      // where the exception lives. The driver still hands the metric fold the
      // full enumeration, so nothing the report counts moves.
      const moves = narrowMoves(ctx.data, ctx.view, ctx.moves);
      const totals = scoreAll(ctx, moves, weights);
      const windowed = windowedPick(ctx, moves, totals);
      if (windowed !== null) return windowed;
      const all = moves.map((_, i) => i);
      const best = bestOf(ctx, moves, totals, all);
      if (best === null) throw new Error(`${id}: no move chosen`);
      return best;
    },
    explain(ctx) {
      return explainAll(ctx, weights).sort((a, b) => b.total - a.total);
    },
  };
}
