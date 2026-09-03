/**
 * The per-card funnel and the cut list.
 *
 * Two rules from ticket 11 shape everything here, and both are about not
 * over-claiming.
 *
 * **The funnel, not a pick rate.** A raw pick rate conflates "everyone passed
 * on this card" with "this card sat in a deck nobody drew from", and at 2 seats
 * only 3 of 5 decks are in play so two whole suits are out of the game. Worse,
 * v14's own principle poisons the naive read: "your junk is their treasure"
 * means the visit fee is SUPPOSED to be the card you least want, so heavy
 * spending is evidence of contempt, not demand. Hence four conditional layers -
 * a high keep rate with a high junk rate is FUEL, NOT A CARD, and that is the
 * most interesting column in the table.
 *
 * **The list ranks; it never stamps.** With 105 cards and only (seats + 1)
 * decks in play, a card's absolute play rate is close to meaningless - it
 * competes with twenty siblings for a handful of builds a game. So the rank
 * within the card's own suit-and-tier BAND is what carries information, `noise`
 * is marked where the interval overlaps the band median, and there is no CUT
 * stamp and no threshold. The designer draws the line looking at the ranking.
 */

import type { GameData } from '@gp/data';
import { handlerFor } from '@gp/engine';

import type { Pooled } from './run.js';
import { median, proportion, wilson } from './stats.js';
import type { Interval } from './stats.js';

export interface FunnelRow {
  readonly id: string;
  readonly name: string;
  readonly suit: string;
  readonly type: string;
  /** Starters are pre-built in every game: they have no funnel, only a row. */
  readonly starter: boolean;
  readonly band: string;
  /** Games in which this card's deck was on the table. */
  readonly inSupply: number;
  readonly surface: number;
  readonly keep: number;
  readonly play: number;
  readonly junk: number;
  readonly playInterval: Interval;
  readonly held: number;
  readonly activations: number;
  readonly vpPerGame: number;
  /** Win rate of seats that built it, minus seats that did not. Never a cut criterion alone. */
  readonly winUplift: number;
  readonly difficulty: number;
}

export interface BandStat {
  readonly band: string;
  readonly medianPlay: number;
  readonly cards: number;
}

export interface CutRow extends FunnelRow {
  /** Play rate minus the median of the card's own suit-and-tier band. */
  readonly vsBand: number;
  /** 1 = bottom of its band. */
  readonly rankInBand: number;
  readonly bandSize: number;
  /** The interval straddles the band median, so the ranking is not distinguishable from noise. */
  readonly noise: boolean;
  /** Junk exceeds play by more than three quarters of the set does: fuel, not a card. */
  readonly fuel: boolean;
}

export function funnel(data: GameData, pooled: Pooled): FunnelRow[] {
  const rows: FunnelRow[] = [];
  for (const card of data.cards.catalogue) {
    const t = pooled.cards.get(card.id);
    if (!t) continue;
    const games = Math.max(1, t.inSupply);
    const play = proportion(t.played, t.held);
    const built = t.builtSeats === 0 ? NaN : t.builtWins / t.builtSeats;
    const unbuilt = t.unbuiltSeats === 0 ? NaN : t.unbuiltWins / t.unbuiltSeats;
    rows.push({
      id: card.id,
      name: card.name,
      suit: card.suit,
      type: card.type,
      starter: card.type === 'starter',
      band: `${card.suit}/${card.type}`,
      inSupply: t.inSupply,
      surface: t.inSupply === 0 ? NaN : t.surfaced / t.inSupply,
      keep: t.surfaced === 0 ? NaN : t.kept / t.surfaced,
      play: play.rate,
      junk: t.held === 0 ? NaN : t.junked / t.held,
      playInterval: play.interval,
      held: t.held,
      activations: t.activations / games,
      vpPerGame: t.vp / games,
      winUplift: built - unbuilt,
      difficulty: handlerFor(card.id)?.difficulty.score ?? NaN,
    });
  }
  return rows;
}

export function bandStats(rows: readonly FunnelRow[]): Map<string, BandStat> {
  const out = new Map<string, BandStat>();
  const bands = new Set(rows.filter((r) => !r.starter).map((r) => r.band));
  for (const band of bands) {
    const inBand = rows.filter((r) => r.band === band && Number.isFinite(r.play));
    out.set(band, {
      band,
      medianPlay: median(inBand.map((r) => r.play)),
      cards: inBand.length,
    });
  }
  return out;
}

/**
 * Every deck card ranked against the median of its own band, worst first.
 * Starters are excluded: they are pre-built in every game, so a play rate for
 * them is a tautology rather than a measurement.
 */
export function cutList(rows: readonly FunnelRow[]): CutRow[] {
  const bands = bandStats(rows);
  const deck = rows.filter((r) => !r.starter);
  const byBand = new Map<string, FunnelRow[]>();
  for (const row of deck) {
    const list = byBand.get(row.band) ?? [];
    list.push(row);
    byBand.set(row.band, list);
  }
  for (const list of byBand.values()) list.sort((a, b) => a.play - b.play);

  // The fuel flag is RELATIVE, and the first real run is why. Absolutely, junk
  // exceeded play for all 90 deck cards - which is not a fault, it is v14's own
  // principle working ("your junk is their treasure": the visit fee is SUPPOSED
  // to be the card you least want). A flag that fires on everything says
  // nothing, so the threshold is the set's own upper quartile of the gap: fuel
  // means "more of a fee than most cards are", not "ever spent".
  const gaps = deck
    .map((r) => r.junk - r.play)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const fuelGap = gaps.length === 0 ? Infinity : (gaps[Math.floor(gaps.length * 0.75)] as number);

  return deck
    .map((row) => {
      const band = bands.get(row.band);
      const order = byBand.get(row.band) ?? [];
      const bandMedian = band?.medianPlay ?? NaN;
      return {
        ...row,
        vsBand: row.play - bandMedian,
        rankInBand: order.indexOf(row) + 1,
        bandSize: order.length,
        noise:
          !Number.isFinite(bandMedian) ||
          (row.playInterval.lo <= bandMedian && row.playInterval.hi >= bandMedian),
        fuel: Number.isFinite(row.junk - row.play) && row.junk - row.play >= fuelGap,
      };
    })
    .sort((a, b) => a.vsBand - b.vsBand || b.difficulty - a.difficulty);
}

/** The interval on a card's play rate, for the report's own use. */
export function playInterval(played: number, held: number): Interval {
  return wilson(played, held);
}
