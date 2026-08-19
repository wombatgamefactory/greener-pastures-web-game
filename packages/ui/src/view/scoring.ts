/**
 * The final scores, with their working shown.
 *
 * The scoring architecture's claim is that all four VP sources are countable
 * from public state. This module is that claim made executable: it takes the
 * engine's `GameScore` and, for every number in it, produces the thing on the
 * table the number came from - which receipts, which cards, which coins. If a
 * line here cannot be traced back to something the player can point at, that is
 * a finding about the design, not a gap in the screen.
 *
 * Three of the four sources are re-derived here from the `PlayerView` alone and
 * then CHECKED against the engine's totals (`agrees`), so a drift between what
 * the screen shows and what the engine scored is visible rather than silent.
 * The fourth, the end-game formulas, cannot be re-derived from a view - they run
 * against the true state - so the engine reports them per card and this module
 * only names them.
 *
 * Nothing here reads a rule constant: the coin pity divisor, the island's VP by
 * arrival order and the number of further turns all come out of `GameData`,
 * because all three are live knobs (the pity rate is flagged OPEN in the design
 * and may be deleted outright).
 */

import type { GameData } from '@gp/data';
import type { GameScore, PlayerView, ScoreBreakdown, Seat } from '@gp/engine';

import { printedFace } from './printed';
import { seatName } from './suits';
import { farmOf } from './table';

export interface ScoredCard {
  readonly id: string;
  readonly name: string;
  readonly vp: number;
  /** Which printed face the VP came from, so a hover shows the face that scored. */
  readonly upgraded: boolean;
}

export interface EndgameCard extends ScoredCard {
  /** The printed formula, so the number beside it can be argued with. */
  readonly text: string;
}

/**
 * Receipts grouped by the thing that now decides what one is worth: the
 * position the seat arrived in at that tile. Under the flat island the levels
 * are decoration, so grouping by level would tell a player nothing; grouping by
 * arrival order is the whole story of their island game.
 */
export interface ArrivalTally {
  /** 0-based position at the tile: 0 = got there first. */
  readonly order: number;
  readonly count: number;
  readonly vpEach: number;
  /** `count * vpEach`. */
  readonly vp: number;
}

export interface CoinPity {
  readonly coins: number;
  readonly divisor: number;
  readonly vp: number;
  /**
   * The card whose own rate stood in for the pity (the Bread Hall). When set,
   * `vp` is 0 here and the coins were scored on that card's line instead - which
   * the screen has to say, or the coins read as forgotten.
   */
  readonly replacedBy: string | null;
}

export interface SeatScore {
  readonly seat: Seat;
  readonly name: string;
  readonly suit: PlayerView['you']['suit'];
  readonly breakdown: ScoreBreakdown;
  readonly rank: number;
  readonly isYou: boolean;
  readonly triggeredEnd: boolean;
  /** Island receipts grouped by arrival order, first-in first. */
  readonly arrivals: readonly ArrivalTally[];
  readonly receiptCount: number;
  /** Built cards printing VP. */
  readonly built: readonly ScoredCard[];
  readonly endgame: readonly EndgameCard[];
  /** Null when the pity rule is switched off in `rules.json`. */
  readonly pity: CoinPity | null;
  readonly coins: number;
  /** Island VP as a percentage of this seat's total. 0 when the total is 0. */
  readonly islandShare: number;
  /**
   * False when the re-derivation disagrees with the engine. Never expected to
   * fire; shown rather than swallowed, because a scoring screen quietly printing
   * different numbers from the ones that decided the game is the worst failure
   * this screen has.
   */
  readonly agrees: boolean;
}

/** Which comparison in DL-16's chain actually separated two seats. */
export type Separator = 'vp' | 'coins' | 'receipts' | 'seat';

export interface Verdict {
  readonly winner: SeatScore;
  readonly runnerUp: SeatScore | null;
  readonly separator: Separator;
  /** The two values that separated them, winner first. Empty when nothing did. */
  readonly margin: readonly [number, number] | null;
  /** The seat whose sixth island delivery ended the game, if one did. */
  readonly trigger: SeatScore | null;
  readonly furtherTurns: number;
}

export interface ScoreReport {
  /** Best first, in ranking order. */
  readonly seats: readonly SeatScore[];
  readonly verdict: Verdict;
  /** Null when the pity rule is off, which is what removes the column. */
  readonly pityDivisor: number | null;
}

/**
 * Where a seat's receipts came from, read off the island rather than off the
 * receipt values. Since the flat island a delivery's VP is decided entirely by
 * its index in the tile's `deliveredBy` list, and that list is public, so the
 * whole of island scoring multiplies back out of what is on the table. Nothing
 * has to be stored per delivery for this to work - which is what keeps the
 * `agrees` check honest, the whole reason this re-derives rather than reading
 * the engine's number.
 */
function arrivalsFor(data: GameData, view: PlayerView, seat: Seat): ArrivalTally[] {
  const counts = new Map<number, number>();
  for (const tile of view.island.tiles) {
    tile.deliveredBy.forEach((who, order) => {
      if (who !== seat) return;
      counts.set(order, (counts.get(order) ?? 0) + 1);
    });
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([order, count]) => {
      const vpEach = data.island.vpByDeliveryOrder[order] ?? 0;
      return { order, count, vpEach, vp: count * vpEach };
    });
}

function seatScore(
  data: GameData,
  view: PlayerView,
  score: GameScore,
  seat: Seat,
  rank: number,
): SeatScore {
  const farm = farmOf(view, seat);
  const breakdown = score.seats[seat];
  if (!breakdown) throw new Error(`No score for seat ${seat}`);

  const arrivals = arrivalsFor(data, view, seat);
  const built = farm.tableau
    .map((b) => {
      const face = printedFace(data, b.card, b.upgraded);
      return { id: b.card, name: face.name, vp: face.printedVp, upgraded: b.upgraded };
    })
    .filter((c) => c.vp > 0);
  const endgame = breakdown.endgameCards.map((e) => {
    const face = printedFace(data, e.card);
    return { id: e.card, name: face.name, text: face.abilityText, vp: e.vp, upgraded: false };
  });

  const divisor = data.rules.economy.coinPityDivisor;
  const replacedBy = breakdown.coinPityReplacedBy;
  const pity =
    divisor === null
      ? null
      : {
          coins: farm.coins,
          divisor,
          vp: replacedBy === null ? Math.floor(farm.coins / divisor) : 0,
          replacedBy: replacedBy === null ? null : printedFace(data, replacedBy).name,
        };

  const islandTotal = arrivals.reduce((sum, a) => sum + a.vp, 0);
  const printedTotal = built.reduce((sum, c) => sum + c.vp, 0);
  const agrees =
    islandTotal === breakdown.receipts &&
    printedTotal === breakdown.printed &&
    (pity?.vp ?? 0) === breakdown.coinPity;

  return {
    seat,
    name: seatName(farm.suit, seat, view.seat),
    suit: farm.suit,
    breakdown,
    rank,
    isYou: seat === view.seat,
    triggeredEnd: view.endTrigger?.seat === seat,
    arrivals,
    receiptCount: farm.receipts.length,
    built,
    endgame,
    pity,
    coins: farm.coins,
    islandShare: breakdown.total > 0 ? (breakdown.receipts / breakdown.total) * 100 : 0,
    agrees,
  };
}

/** The three comparable quantities in DL-16's chain, before it falls back to seat order. */
export interface Standing {
  readonly total: number;
  readonly coins: number;
  readonly receipts: number;
}

/**
 * Why the winner won. The engine's ranking already applies DL-16's whole chain
 * (VP, then coins, then receipts taken, then seat order); this re-walks the same
 * chain over two seats purely to say WHICH link decided it, because a close game
 * that just announces a winner reads as arbitrary.
 *
 * It deliberately does NOT re-rank. If this ever disagreed with the engine the
 * engine would still be right; what it produces is a sentence.
 */
export function separatorOf(a: Standing, b: Standing): Pick<Verdict, 'separator' | 'margin'> {
  const pairs: readonly [Separator, number, number][] = [
    ['vp', a.total, b.total],
    ['coins', a.coins, b.coins],
    ['receipts', a.receipts, b.receipts],
  ];
  for (const [separator, x, y] of pairs) {
    if (x !== y) return { separator, margin: [x, y] };
  }
  return { separator: 'seat', margin: null };
}

function standingOf(s: SeatScore): Standing {
  return { total: s.breakdown.total, coins: s.coins, receipts: s.receiptCount };
}

export function scoreReport(data: GameData, view: PlayerView, score: GameScore): ScoreReport {
  const seats = score.ranking.map((seat, i) => seatScore(data, view, score, seat, i + 1));
  const winner = seats[0];
  if (!winner) throw new Error('A finished game has at least one seat');
  const runnerUp = seats[1] ?? null;

  return {
    seats,
    verdict: {
      winner,
      runnerUp,
      ...(runnerUp
        ? separatorOf(standingOf(winner), standingOf(runnerUp))
        : ({ separator: 'vp', margin: null } as const)),
      trigger: seats.find((s) => s.triggeredEnd) ?? null,
      furtherTurns: data.rules.endGame.furtherTurnsEach,
    },
    pityDivisor: data.rules.economy.coinPityDivisor,
  };
}

/** "wins by 12 VP" / "wins the tie-break on coins, £7 to £3". */
export function verdictLine(verdict: Verdict): string {
  const { separator, margin } = verdict;
  if (!verdict.runnerUp) return 'takes the island.';
  if (separator === 'vp' && margin) {
    const by = margin[0] - margin[1];
    return by === 0 ? 'wins.' : `wins by ${by} VP, ${margin[0]} to ${margin[1]}.`;
  }
  const level = `level on ${verdict.winner.breakdown.total} VP`;
  if (separator === 'coins' && margin) {
    return `wins the tie-break: ${level}, ahead on coins, £${margin[0]} to £${margin[1]}.`;
  }
  if (separator === 'receipts' && margin) {
    return `wins the tie-break: ${level} and on coins, ahead on receipts taken, ${margin[0]} to ${margin[1]}.`;
  }
  return `wins on seat order: ${level}, on coins and on receipts taken, which is where the tie-break runs out.`;
}
