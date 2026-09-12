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
 *
 * ⭐ THREE WERE ADDED ON 12/09/2026 FOR LEDGER ROW C115 AND NOTHING WAS
 * RENAMED, which is the rule above applied rather than an oversight:
 * `bonus slot used, share of turns`, `door mix, busiest board share` and
 * `farm bypass share`. ⛔ THE FIRST IS A GENUINELY DIFFERENT QUANTITY FROM
 * `visits per turn`, WHICH IS THE PLAYS MEASURE, and both stay: a card that
 * grants a second play in one turn breaks the denominator between them (A
 * Helping Hand, about ten points), Dean's 30%-60% band is a share of TURNS, and
 * judging it on plays cost this project a re-run of five arms on 09/09/2026.
 * ⚠️ The three arrive with NO recorded movement, so `--noise` has to be re-run
 * before any of them has a floor; until then they print in every sweep header
 * as unquoted, which is correct and is the point.
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
    // ⭐⭐ NEW ON 12/09/2026 FOR LEDGER ROW C115, AND IT IS THE ONE THAT
    // MATTERS MOST ON THIS LIST. `visits per turn` above is the PLAYS measure;
    // this is the share of TURNS on which the bonus slot was used, and ⛔ THE
    // TWO ARE DIFFERENT QUANTITIES rather than two roundings of one. A Helping
    // Hand puts a SECOND play in one turn, so plays run about ten points above
    // turns (68.5% against 58.9% on the commons baseline of 09/09/2026), and
    // Dean's band of 30% to 60% is a share of TURNS. Judging it on plays cost
    // this project a re-run of five arms on 09/09/2026, and A148's headline is a
    // one-tenth-of-a-point band comparison at four seats with nothing to read it
    // against. ⚠️ BOTH LABELS STAY: `visits per turn` is not renamed, because a
    // rename retires the floor recorded under the old key, and because the plays
    // measure is still the right denominator for anything asking how much
    // traffic the slot carries.
    label: 'bonus slot used, share of turns',
    of: bonusSlotTurnShare,
    fmt: (x) => pct(x, 1),
  },
  {
    // ⭐ NEW ON 12/09/2026 FOR C115. ⚠️ THE DOOR MIX IS FIVE NUMBERS AND THIS IS
    // ONE, SO THE FLOOR IT EARNS IS A FLOOR ON THE SUMMARY AND NOT ON THE
    // COMPONENTS. The busiest board's share is the scalar chosen because it is
    // the exact quantity a07 carries its verdict on (FAIL above 35%), so a floor
    // here bounds the number a reader is actually judging. ⛔ WHAT IT LOSES: a
    // reshuffle of the mix that leaves the leader's share alone moves this by
    // zero, and the leader can CHANGE crop between two arms while the share
    // barely moves - which is a real finding (it happened on the bonus-last
    // control of 09/09/2026, wheat 35 / apiary 33 against apiary 36 / wheat 30)
    // and this metric cannot see it. Read a07's own by-colour line for that.
    label: 'door mix, busiest board share',
    of: busiestDoorShare,
    fmt: (x) => pct(x, 1),
  },
  {
    // ⭐ NEW ON 12/09/2026 FOR C115. The share of HARVESTED barn cards that came
    // from somewhere other than the seat's own buildings: a central pile under
    // the commons, a rival's fee off your own Notice Board under
    // `noticeBoardPower`, and a structural zero under the v31 card game and the
    // meeple loop, where no harvest can reach either. ⚠️ IT IS A SINGLE SCALAR
    // OVER A SPLIT THAT IS THREE-WAY UNDER ONE MODE (own farm / rival's fee /
    // the centre), and it pools the second and third: what it loses is WHICH
    // bypass, which is a18's line and not this one. The bypass SHARE is the
    // scalar because it is the number the design's own sentence is written
    // about - "if the centre out-supplies the farm, the building engine is
    // decoration" - and because it is the one reading in this family with no
    // fail condition at all, so a floor is the only thing it can ever be read
    // against.
    label: 'farm bypass share',
    of: farmBypassShare,
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

/**
 * ⛔ THE SHARE OF TURNS ON WHICH THE BONUS SLOT WAS USED - the quantity Dean's
 * 30% to 60% band is written in, and NOT the same quantity as `visitsPerTurn`.
 *
 * A turn counts once however many plays it carried, which is the whole point:
 * A Helping Hand's second play inflates the plays measure by about ten points
 * and cannot inflate this one. Every currency feeds `bonusTurnsBySeat`, so the
 * reading is mode-independent, and a self-visit counts - the band is about how
 * often the slot is SPENT, and a17 is where the mix of what it was spent on
 * lives.
 */
export function bonusSlotTurnShare(p: Pooled): number {
  const turns = sum(p.ended.map((g) => sum(g.turnsBySeat)));
  return turns === 0 ? NaN : sum(p.ended.map((g) => sum(g.bonusTurnsBySeat))) / turns;
}

/**
 * The door mix reduced to ONE number: the busiest board's share of all door
 * uses, which is the exact quantity a07 fails above 35% on.
 *
 * ⚠️ A FLOOR ON THIS IS NOT A FLOOR ON THE MIX. The mix is five shares and
 * this is their maximum, so it is blind to any reshuffle beneath the leader and
 * blind to the leader changing crop at a similar share. a07 prints all five.
 */
export function busiestDoorShare(p: Pooled): number {
  const uses = new Map<string, number>();
  for (const g of p.ended) {
    for (const [colour, n] of Object.entries(g.doorUsesByColour)) {
      uses.set(colour, (uses.get(colour) ?? 0) + n);
    }
  }
  const total = sum([...uses.values()]);
  if (total === 0 || uses.size === 0) return NaN;
  return Math.max(...uses.values()) / total;
}

/**
 * The farm bypass as one number: harvested barn cards that did NOT come off the
 * seat's own buildings, over every harvested barn card.
 *
 * ⛔ THE SUBTRACTION IS LOAD-BEARING AND IT IS a18's. `barnFromOwnBySeat`
 * counts a Notice Board harvest too, because under `noticeBoardPower` a board IS
 * a building in a tableau and the engine rightly says `source: 'tableau'` - so
 * the farm is `barnFromOwnBySeat` MINUS `barnFromOwnBoardBySeat`, and the bypass
 * is everything else. Under the commons `barnFromOwnBoardBySeat` is a structural
 * zero and this reduces to the centre share (63.0% on the 09/09/2026 baseline);
 * under the v31 card game and the meeple loop both bypass terms are structural
 * zeroes and it reads 0.
 *
 * ⚠️ The denominator is HARVESTED cards only, never `barnInBySeat`, which
 * pools the deck, hand, stack and discard shortcuts as well.
 */
export function farmBypassShare(p: Pooled): number {
  const ownAll = sum(p.ended.map((g) => sum(g.barnFromOwnBySeat)));
  const ownBoard = sum(p.ended.map((g) => sum(g.barnFromOwnBoardBySeat)));
  const centre = sum(p.ended.map((g) => sum(g.barnFromCommonsBySeat)));
  const farm = Math.max(0, ownAll - ownBoard);
  const harvested = farm + ownBoard + centre;
  return harvested === 0 ? NaN : (ownBoard + centre) / harvested;
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
