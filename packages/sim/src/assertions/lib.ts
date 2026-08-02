/**
 * Shared readings the assertions take off a pooled run.
 *
 * Everything here is a projection, never a judgement: an assertion decides what
 * a number means, this file only computes it. Keeping the two apart is what
 * lets a taste-sensitive assertion re-measure itself against a mirror pool
 * without duplicating its own arithmetic.
 */

import type { Suit } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Pooled } from '../run.js';
import { median, sum } from '../stats.js';

/** Ended games only. Ticket 11 section 7: balance means exclude stalls, with the bias printed. */
export function endedGames(pooled: Pooled): readonly GameMetrics[] {
  return pooled.ended;
}

export function bySeatCount<T>(pooled: Pooled, f: (games: readonly GameMetrics[]) => T): T[] {
  return pooled.bySeats.map((slice) => f(slice.ended));
}

/** Coins each player is sitting on when the game stops, pooled as a median. */
export function endCoins(games: readonly GameMetrics[]): number {
  const all: number[] = [];
  for (const g of games) {
    const last = g.coinsByRound[g.coinsByRound.length - 1];
    if (last !== undefined) all.push(last);
  }
  return median(all);
}

/**
 * The last k round-end coin medians, pooled position by position from the END
 * of the game. Games are different lengths, so aligning on the final round is
 * the only alignment that means anything.
 */
export function tailSeries(
  games: readonly GameMetrics[],
  k: number,
  pick: (g: GameMetrics) => number[],
): number[] {
  const out: number[] = [];
  for (let offset = k - 1; offset >= 0; offset--) {
    const values: number[] = [];
    for (const g of games) {
      const series = pick(g);
      const v = series[series.length - 1 - offset];
      if (v !== undefined) values.push(v);
    }
    out.push(median(values));
  }
  return out;
}

export function totalTurns(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.turnsBySeat)));
}

export function totalVisits(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.visitsBySeat)));
}

export function totalBonusTurns(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.bonusTurnsBySeat)));
}

/** Rival uses of every Worker, by worker id. */
export function rivalUses(games: readonly GameMetrics[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of games) {
    for (const [worker, n] of Object.entries(g.rivalUsesByWorker)) {
      out.set(worker, (out.get(worker) ?? 0) + n);
    }
  }
  return out;
}

/** Every seat-game as a flat row - the unit most of the taste readings work in. */
export interface SeatRow {
  readonly game: GameMetrics;
  readonly seat: number;
  readonly suit: Suit;
  readonly won: boolean;
}

export function seatRows(games: readonly GameMetrics[]): SeatRow[] {
  const out: SeatRow[] = [];
  for (const game of games) {
    game.suits.forEach((suit, seat) => {
      out.push({ game, seat, suit, won: game.winner === seat });
    });
  }
  return out;
}

/** Split a series into thirds and return the median of the named third. */
export function thirdMedian(series: readonly number[], which: 'first' | 'middle' | 'last'): number {
  if (series.length < 3) return NaN;
  const cut = series.length / 3;
  const slice =
    which === 'first'
      ? series.slice(0, Math.ceil(cut))
      : which === 'middle'
        ? series.slice(Math.ceil(cut), Math.ceil(2 * cut))
        : series.slice(Math.ceil(2 * cut));
  return median(slice);
}
