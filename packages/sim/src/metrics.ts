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
  { label: 'end coins per player', of: endCoins, fmt: (x) => `£${num(x, 1)}` },
  { label: 'barn at game end', of: endBarn, fmt: (x) => num(x, 1) },
  {
    label: 'game length, rounds',
    of: (p) => median(p.ended.map((g) => g.rounds)),
    fmt: (x) => num(x, 1),
  },
  { label: 'visits per turn', of: visitsPerTurn, fmt: (x) => num(x, 2) },
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
    // The single most sensitive number in the method, so it is the one the noise
    // floor most needs to bound. Summarised as the WORST chair at any seat
    // count, in percentage points, because that is what a reader judges against
    // the +/-3 band.
    label: 'seat deviation',
    of: worstSeatDeviation,
    fmt: (x) => `${num(x, 1)} pts`,
  },
];

export function endCoins(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.coinsByRound.slice(-1)));
}

export function endBarn(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.barnByRound.slice(-1)));
}

export function visitsPerTurn(p: Pooled): number {
  const turns = sum(p.ended.map((g) => sum(g.turnsBySeat)));
  return turns === 0 ? NaN : sum(p.ended.map((g) => sum(g.visitsBySeat))) / turns;
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
