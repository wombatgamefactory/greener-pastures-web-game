import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { REFERENCE } from '../reference.js';
import { num, pct } from '../stats.js';

/**
 * THE HAND AGAINST THE ENGINE'S BOUND, AND THE DECISION SPACE IT FEEDS.
 *
 * ⭐ RE-CUT ON 16/09/2026. This page was born on 12/09/2026 as `a27-coin-hand`,
 * asking what the Village Store's coin sinks did to a hand: a coin paid no card,
 * so cards stopped leaving the hand. Dean deleted the Store on 16/09/2026 (R2),
 * and the page keeps the half that never needed a coin: the hand at the start
 * of a turn, the share of turns already AT the bound, and the worst end-of-turn
 * discard enumeration, which no other page prints. On reference-v19 that
 * enumeration reached 657,800 legal moves at 4p, the largest in the project.
 *
 * ## ⭐⭐ THIS IS THE SHAPE THAT BROKE THE PROJECT ON 02/09/2026
 *
 * v31 deleted the hand limit on the reading that it was "the master clock" and
 * therefore redundant. **The reading was wrong about the engine.** Measured,
 * paired, same seeds: the worst single two-seat position offered **116,535 legal
 * moves**, of which 116,503 were build payments, at a hand of 41; and a two-seat
 * game took **91.5 seconds** against 0.1s before. The limit came back at 12 the
 * next day and was cut to 7 for runtime the same day.
 *
 * ## ⛔⛔ C7 IS ON EVERY LINE OF THIS PAGE
 *
 * The engine's `rules.turn.handLimit` is **the SIMULATOR'S bound and not a rule
 * of the game**: the table plays with no hand limit at all (C7). So every
 * number here is a FLOOR on what the rules do to a hand: the instrument clips the
 * growth and then reports the clipped figure. A mean that barely moves while the
 * share of turns AT THE BOUND climbs is the clipping, not the absence of an
 * effect, which is why those two lines are printed together and never apart.
 *
 * ⚠️ This page, a21 and a22 read the same four hand counters, folded once at the
 * first decision of every turn. They are not three findings.
 *
 * ## ⛔ NO FAIL CONDITION
 *
 * The quantity belongs to the instrument rather than to the game, so a guard
 * here would be a guard on the simulator. ⛔ If the discard enumeration climbs
 * far enough to cost runtime, the answer is a bot-side discard heuristic
 * (CLAUDE.md section 2.3), never a rules change.
 */
export const handBound: Assertion = {
  id: 27,
  title: 'The hand against the engine bound, and the worst discard enumeration',
  quote:
    'The engine’s discard task is what caps the hand at 7, and that limit is the SIMULATOR’S ' +
    'bound (C7) while the table plays with none. ⭐ Deleting the hand limit on 02/09/2026 ' +
    'produced a 116,535-move position, so the discard enumeration is the engine-cost risk to ' +
    'watch.',
  source:
    'C7 and section 2.3 of CLAUDE.md for the bound; the v31 hand-limit measurement of ' +
    '02/09/2026 for the shape. Born as a27-coin-hand with the Village Store build of ' +
    '12/09/2026 and re-cut without the coin on 16/09/2026.',
  shape:
    'Mean and PEAK hand at the start of a turn, pooled and by seat count, with the share of ' +
    'turns already AT the engine’s bound beside them. Plus the decision space the hand feeds: ' +
    'the worst end-of-turn discard enumeration and the worst position of any kind.',
  threshold:
    'OBSERVE, NO FAIL CONDITION. Under C7 the quantity belongs to the INSTRUMENT and not to ' +
    'the game, and the readings are a FLOOR rather than an estimate.',
  taste: true,
  remedy:
    `${NO_REMEDY} for the hand itself. ⛔ IF THE DISCARD ENUMERATION CLIMBS FAR ENOUGH TO COST ` +
    'RUNTIME, THE ANSWER IS AN INSTRUMENT CHANGE AND NEVER A RULES CHANGE: a bot-side discard ' +
    'heuristic in place of the task, which nobody has designed.',
  measure(ctx) {
    return handMode(ctx);
  },
};

interface HandRow {
  turns: number;
  held: number;
  atBound: number;
  peak: number;
  discardMoves: number;
  legalMoves: number;
}

function handRow(games: readonly GameMetrics[]): HandRow {
  const r: HandRow = { turns: 0, held: 0, atBound: 0, peak: 0, discardMoves: 0, legalMoves: 0 };
  for (const g of games) {
    r.turns += g.handSampledTurns;
    r.held += g.handSizeSum;
    r.atBound += g.handAtBoundTurns;
    r.peak = Math.max(r.peak, g.handSizeMax);
    r.discardMoves = Math.max(r.discardMoves, g.maxDiscardMoves);
    r.legalMoves = Math.max(r.legalMoves, g.maxLegalMovesSeen);
  }
  return r;
}

function handMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const r = handRow(games);
  if (r.turns === 0) {
    return { value: NaN, headline: 'not measured: no turns sampled', verdict: 'OBSERVE' };
  }
  // The scalar is the mean hand at the start of a turn. ⚠️ It is the most
  // clipped of the three lines on this page, which is why the peak and the
  // at-bound share are printed beside it in the headline and not below.
  const value = r.held / r.turns;
  const bound = data.rules.turn.handLimit;

  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, r: handRow(slice.ended) }));

  const detail = [
    `THE HAND AT THE START OF A TURN, over ${r.turns} turns sampled in ${games.length} ended ` +
      `games: mean ${num(value, 2)} cards, PEAK ${r.peak}, and ` +
      `${pct(r.atBound / r.turns)} of turns began ALREADY AT the engine’s bound of ` +
      `${bound === null ? 'none' : bound}. ⛔ THE THREE ARE ONE READING AND MUST NOT BE ` +
      'SEPARATED: the bound is what makes the mean understate.',
    `⛔⛔ THE BOUND IS THE SIMULATOR’S AND NOT A RULE OF THE GAME (C7). ` +
      `rules.turn.handLimit is ${bound === null ? 'null' : bound} here because the engine ` +
      'cannot enumerate an unbounded hand; THE TABLE PLAYS WITH NO HAND LIMIT AT ALL. Every ' +
      'number on this page is a FLOOR.',
    `⛔ THE DECISION SPACE THE HAND FEEDS: the worst END-OF-TURN DISCARD enumeration in the ` +
      `pass offered ${r.discardMoves} legal moves, and the worst position of any kind offered ` +
      `${r.legalMoves}. The discard task enumerates every subset of the overflow, so its width ` +
      'is C(hand, hand - limit) and it climbs like a binomial and not like a hand.',
    `BY SEAT COUNT: ${bySeat
      .map(
        (s) =>
          `${s.seats}p [mean ${num(s.r.turns === 0 ? NaN : s.r.held / s.r.turns, 2)}  peak ` +
          `${s.r.peak}  at bound ${pct(s.r.turns === 0 ? NaN : s.r.atBound / s.r.turns)}  worst ` +
          `discard ${s.r.discardMoves}]`,
      )
      .join('  ')}. ⚠️ The worst position of the pass is a single game and not a distribution.`,
    '⚠️ THIS PAGE, a21-host-draw AND a22-crop-diagnosis ALL READ THE SAME FOUR HAND COUNTERS ' +
      'AND ARE NOT THREE FINDINGS. Quoting two of the three as independent evidence is ' +
      'double-counting one sample.',
    `⛔ NO FAIL CONDITION. THE INSTRUMENT IS ${REFERENCE.id}, and no hand line is in ` +
      'HEADLINE_METRICS, so the noise floor covers nothing on this page.',
  ];

  return {
    value,
    headline:
      `THE HAND AGAINST THE BOUND: mean ${num(value, 2)} cards at the start of a turn, PEAK ` +
      `${r.peak}, and ${pct(r.atBound / r.turns)} of turns began already at the engine’s bound ` +
      `of ${bound === null ? 'none' : bound}; the worst end-of-turn discard enumeration offered ` +
      `${r.discardMoves} legal moves (worst position of any kind ${r.legalMoves}). ⛔ THE BOUND ` +
      'IS THE SIMULATOR’S (C7) AND THE TABLE PLAYS WITH NONE.',
    detail,
    verdict: 'OBSERVE',
  };
}

/** Kept beside the metrics type so a future reader can see what this file reads. */
export type HandBoundMetrics = Pick<
  GameMetrics,
  | 'handSampledTurns'
  | 'handSizeSum'
  | 'handAtBoundTurns'
  | 'handSizeMax'
  | 'maxDiscardMoves'
  | 'maxLegalMovesSeen'
>;
