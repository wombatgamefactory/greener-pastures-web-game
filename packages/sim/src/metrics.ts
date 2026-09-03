/**
 * The headline metrics, in one place, because two tools have to agree on them.
 *
 * A sweep prints deltas. `--noise` prints how far the same quantity moves
 * between two identical runs on two seeds. Those two numbers are only
 * comparable - and the second is only useful - if they are literally the same
 * arithmetic, so the list lives here rather than inline in `sweep.ts` where it
 * started.
 *
 * `label` is the key the noise floor is recorded under in `reference.ts`. Rename
 * one and the recorded floor for it goes stale silently, so treat these strings
 * as data rather than as prose.
 */

import type { Pooled } from './run.js';
import { median, num, pct, sum } from './stats.js';

export interface Metric {
  readonly label: string;
  readonly of: (pooled: Pooled) => number;
  readonly fmt: (x: number) => string;
}

export const HEADLINE_METRICS: readonly Metric[] = [
  {
    // ⭐ REPLACED 'end coins per player' (v31). The currency is gone; what a
    // seat ends holding now is MEEPLES, and a meeple is a stored action rather
    // than money. The label changed with the meaning, which retires the noise
    // floor recorded under the old key - by design: a floor keyed to a metric
    // that no longer exists is worse than none.
    label: 'meeples held at game end',
    of: endMeeples,
    fmt: (x) => num(x, 1),
  },
  { label: 'barn at game end', of: endBarn, fmt: (x) => num(x, 1) },
  {
    label: 'game length, rounds',
    of: (p) => median(p.ended.map((g) => g.rounds)),
    fmt: (x) => num(x, 1),
  },
  { label: 'visits per turn', of: visitsPerTurn, fmt: (x) => num(x, 2) },
  {
    // ⭐ NEW IN v31, and the number the whole pass moves (risk 1). It belongs
    // in the headline list rather than only in assertion 16 because a sweep
    // prints deltas off this list, and the end trigger is dialled against it.
    label: 'actions per turn',
    of: actionsPerTurn,
    fmt: (x) => num(x, 2),
  },
  {
    label: 'meeple spend rate',
    of: meepleSpendRate,
    fmt: (x) => pct(x, 1),
  },
  {
    // The hook, in the headline list, and NEIGHBOUR visits only: pooling in a
    // self-visit would let a solitaire table report a healthy hook.
    label: 'self-visit share of visits',
    of: selfVisitShare,
    fmt: (x) => pct(x, 1),
  },
  {
    label: 'unfinished games',
    of: (p) => 1 - p.ended.length / Math.max(1, p.all.length),
    fmt: (x) => pct(x, 1),
  },
  { label: 'winning score', of: winningScore, fmt: (x) => num(x, 1) },
  {
    label: 'last as % of winner',
    of: (p) => median(p.bySeats.map((s) => s.lastPctOfWinner).filter(Number.isFinite)),
    fmt: (x) => pct(x, 1),
  },
  {
    label: 'tied top score',
    of: (p) => median(p.bySeats.map((s) => s.tieRate).filter(Number.isFinite)),
    fmt: (x) => pct(x, 1),
  },
  {
    // The C1 metric, tracked from 2026-08-09 (the pile-of-cards lens review).
    // Split played/neutral in the report; pooled here because a sweep needs one
    // number per metric, and because the pooled figure is the one that answers
    // "did this change make the game churn its pool harder".
    label: 'deck reshuffles per game',
    of: reshufflesPerGame,
    fmt: (x) => num(x, 2),
  },
  {
    label: 'reshuffles, played crop',
    of: (p) => reshufflesPerDeck(p, 'played'),
    fmt: (x) => num(x, 2),
  },
  {
    // The single most sensitive number in the method, so it is the one the noise
    // floor most needs to bound. Summarised as the WORST chair at any seat
    // count, in percentage points, because that is what a reader judges against
    // the +/-3 band.
    label: 'seat deviation',
    of: worstSeatDeviation,
    fmt: (x) => `${num(x, 1)} pts`,
  },
];

export function endMeeples(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.meeplesByRound.slice(-1)));
}

export function endBarn(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.barnByRound.slice(-1)));
}

/** NEIGHBOUR visits per turn. A self-visit is solitaire and never counts here. */
export function visitsPerTurn(p: Pooled): number {
  const turns = sum(p.ended.map((g) => sum(g.turnsBySeat)));
  const visits = sum(p.ended.map((g) => sum(g.visitsBySeat) - sum(g.selfVisitsBySeat)));
  return turns === 0 ? NaN : visits / turns;
}

/** Core actions resolved per player per turn, every route pooled (risk 1). */
export function actionsPerTurn(p: Pooled): number {
  const turns = sum(p.ended.map((g) => sum(g.turnsBySeat)));
  return turns === 0 ? NaN : sum(p.ended.map((g) => sum(g.actionsBySeat))) / turns;
}

/** Meeples spent as a share of meeples gained. Below half is a dead component. */
export function meepleSpendRate(p: Pooled): number {
  const gained = sum(p.ended.map((g) => sum(g.meeplesGainedBySeat)));
  return gained === 0 ? NaN : sum(p.ended.map((g) => sum(g.meeplesSpentBySeat))) / gained;
}

/** Risk 2, as one number: how much of the bonus slot's interaction went inward. */
export function selfVisitShare(p: Pooled): number {
  const all = sum(p.ended.map((g) => sum(g.visitsBySeat)));
  return all === 0 ? NaN : sum(p.ended.map((g) => sum(g.selfVisitsBySeat))) / all;
}

/** Total discard-to-deck reshuffles in a game, all crops, median over ended games. */
export function reshufflesPerGame(p: Pooled): number {
  return median(p.ended.map((g) => sum(Object.values(g.reshufflesByCrop))));
}

/**
 * Reshuffles per DECK per game, split by whether that crop is being farmed.
 *
 * The split is the whole point and the pooled figure hides it: a played crop's
 * central deck is 12 cards and a neutral crop's is 18, so they churn at wildly
 * different rates and averaging them describes neither. Per deck rather than
 * per game so the two halves are comparable at any seat count.
 */
export function reshufflesPerDeck(p: Pooled, which: 'played' | 'neutral'): number {
  const perDeck: number[] = [];
  for (const g of p.ended) {
    const crops = which === 'played' ? g.suits : g.neutral;
    for (const crop of crops) perDeck.push(g.reshufflesByCrop[crop] ?? 0);
  }
  return median(perDeck);
}

export function winningScore(p: Pooled): number {
  return median(
    p.ended.flatMap((g) => (g.winner === null ? [] : [g.scores[g.winner]?.total ?? NaN])),
  );
}

/** The furthest any chair sits from an even split, in percentage points, signed. */
export function worstSeatDeviation(p: Pooled): number {
  let worst = 0;
  for (const slice of p.bySeats) {
    const even = 1 / slice.seats;
    for (const s of slice.bySeatIndex) {
      if (s.games === 0) continue;
      const dev = (s.wins / s.games - even) * 100;
      if (Math.abs(dev) > Math.abs(worst)) worst = dev;
    }
  }
  return worst;
}
