/**
 * `reference-v1` - the frozen instrument.
 *
 * Ticket 11's first decision, and the reason this file is committed rather than
 * assembled from CLI flags: the bots are the subject as well as the instrument.
 * The same engine and the same cards gave end-game coin piles of £63/£159/£220
 * under a `pulse` mirror and £46/£33/£31 under a mixed scored table - climb
 * versus plateau, assertion 1 passing or failing purely on who sat in the
 * chairs. So one configuration is named, frozen and printed in every report
 * header, and every card economic and every watch-list threshold is defined
 * against it and is meaningless without it.
 *
 * Retuning a weight profile does not silently move the numbers. It mints
 * `reference-v2`, and the old report stays readable because it names what
 * produced it.
 */

import type { Suit } from '@gp/data';
import { SUITS } from '@gp/data';
import type { PolicyId } from '@gp/bots';
import { BALANCE_PROFILES } from '@gp/bots';

export interface ReferenceConfig {
  readonly id: string;
  readonly description: string;
  /** The profile pool seats are drawn from, one per seat, from the run seed. */
  readonly pool: readonly PolicyId[];
  /** Target games per seat count. Rounded UP to a whole number of cells. */
  readonly targetGames: Readonly<Record<number, number>>;
  readonly seatCounts: readonly number[];
  /** Move ceiling per game. A game that hits it is `maxMoves`, never thrown. */
  readonly maxMoves: number;
  /** The default run seed. A different seed is a different sample, not a different reference. */
  readonly seed: string;
}

export const REFERENCE_V1: ReferenceConfig = {
  id: 'reference-v1',
  description:
    'Mixed scored profiles, one per seat from the run seed; suits stratified through every ' +
    'legal (player suits + neutral deck) combination; 2, 3 and 4 seats.',
  pool: BALANCE_PROFILES,
  targetGames: { 2: 500, 3: 500, 4: 500 },
  seatCounts: [2, 3, 4],
  maxMoves: 6000,
  seed: 'reference-v1',
};

/**
 * One stratified cell: the suits at the table.
 *
 * Ticket 07 put exactly (seats + 1) decks in play with unchosen crops out of
 * the game entirely, so a fixed suit set gives 42 cards n = 0. Rotating
 * deterministically through every legal combination gives uniform per-card
 * coverage when pooled, and a suit-matchup table for free when split.
 */
export interface Cell {
  readonly seats: number;
  /** Player suits, in seat order (canonical SUITS order within the cell). */
  readonly suits: readonly Suit[];
  /** The passive decks nobody farms. */
  readonly neutral: readonly Suit[];
  readonly label: string;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * Every legal cell at this seat count: 30 at 2 seats, 20 at 3, 5 at 4.
 *
 * Player suits are taken as an unordered SET and seated in canonical order.
 * Seat order is not a stratification axis - the profile assignment already
 * rotates who sits where, and treating (wheat, dairy) and (dairy, wheat) as
 * different cells would double the run for no extra coverage.
 */
export function cellsFor(seats: number, decksInPlay: number): Cell[] {
  const neutralCount = decksInPlay - seats;
  const out: Cell[] = [];
  for (const suits of combinations(SUITS, seats)) {
    const rest = SUITS.filter((s) => !suits.includes(s));
    for (const neutral of combinations(rest, neutralCount)) {
      out.push({
        seats,
        suits,
        neutral,
        label: `${suits.map(short).join('')}+${neutral.map(short).join('') || '-'}`,
      });
    }
  }
  return out;
}

export function short(suit: Suit): string {
  return suit === 'wheat'
    ? 'W'
    : suit === 'vegetable'
      ? 'V'
      : suit === 'orchard'
        ? 'O'
        : suit === 'apiary'
          ? 'A'
          : 'D';
}

/**
 * Games per cell at this seat count: the target rounded UP so every cell gets
 * the same number. Rounding up rather than down keeps the stratification exact
 * at the cost of a few extra games, and an uneven cell would quietly weight one
 * suit matchup above another in every pooled number in the report.
 */
export function gamesPerCell(target: number, cellCount: number): number {
  return Math.max(1, Math.ceil(target / cellCount));
}
