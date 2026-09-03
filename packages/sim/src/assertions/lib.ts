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

/** Every visit, self-visits included. Use `totalNeighbourVisits` for the hook. */
export function totalVisits(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.visitsBySeat)));
}

/**
 * Visits to SOMEBODY ELSE'S board. The only figure the hook may be measured
 * with: a self-visit is a solitaire door bought with the interaction door's
 * currency, so crediting it would report a healthy hook at a solitaire table.
 */
export function totalNeighbourVisits(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.visitsBySeat) - sum(g.selfVisitsBySeat)));
}

export function totalBonusTurns(games: readonly GameMetrics[]): number {
  return sum(games.map((g) => sum(g.bonusTurnsBySeat)));
}

/**
 * Visits per turn, split by the SUIT the seat was playing.
 *
 * The table average alone cannot answer a per-suit question, and the design asks
 * one of every suit it changes: does this suit's engine pull its player away from
 * their neighbours? It arrived with the Wheat rebuild, where W10 The Furrow banks
 * the whole hand and a visit costs a card, so a Furrow turn is a turn the hook
 * does not get. Nothing here is Wheat-specific - every suit gets a row, and the
 * comparison that matters is against the table's own mean.
 */
export function visitsPerTurnBySuit(games: readonly GameMetrics[]): Map<Suit, number> {
  const visits = new Map<Suit, number>();
  const turns = new Map<Suit, number>();
  for (const g of games) {
    g.suits.forEach((suit, seat) => {
      // NEIGHBOUR visits only, for the reason `totalNeighbourVisits` states.
      const mine = (g.visitsBySeat[seat] ?? 0) - (g.selfVisitsBySeat[seat] ?? 0);
      visits.set(suit, (visits.get(suit) ?? 0) + mine);
      turns.set(suit, (turns.get(suit) ?? 0) + (g.turnsBySeat[seat] ?? 0));
    });
  }
  const out = new Map<Suit, number>();
  for (const [suit, played] of turns)
    out.set(suit, played === 0 ? NaN : (visits.get(suit) ?? 0) / played);
  return out;
}

/**
 * ⛔ `rivalUses` IS GONE (v31). It pooled rival uses of every Hired Worker by
 * worker id, for the Draw Worker assertion. There are no Workers; the door mix
 * (a07) folds `doorUsesByColour` itself, because it needs the three routes
 * split and a shared helper would only have pooled them again.
 */

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
