import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { thirdMedian } from './lib.js';
import { median, num } from '../stats.js';

/**
 * Watch-list 6, and the assertion whose framing has already been corrected once.
 *
 * Ticket 14 raised the island cost to 2/6/9 partly on the argument that a
 * dearer island drains barns. A probe said the opposite: median barn at game
 * end went 5 -> 9 at 2p under the dearer cost, because seats HOARD toward a
 * 9-card Level 3 instead of spending down. So the endpoint is the wrong
 * measurement and the design's own instruction is a series: the 2026-07-14 game
 * stopped before the delivery phase that exists to drain barns, and the answer
 * was "play a full game before designing anything".
 *
 * Hence a within-game comparison, final third against middle third. The claim
 * under test is not "barns are small" - it is "the delivery phase drains them".
 */
export const barnGlut: Assertion = {
  id: 6,
  title: 'The barn glut',
  quote:
    'Too much stuff in your barn is a problem, but a hard cap might not be the answer. The ' +
    '2026-07-14 game stopped 3-4 rounds early - before the delivery phase that exists to drain ' +
    'barns. Play a full game before designing anything.',
  source: 'docs/Unified Visit v14.md section 7.6',
  shape:
    'Median barn size across the last third of the game against the middle third - the drain, ' +
    'not the endpoint.',
  threshold: 'FAIL if the final-third median exceeds the middle-third median',
  taste: false,
  remedy:
    `${NO_REMEDY}. The design explicitly rules out a hard cap and lists only candidates ` +
    '(a County Show barn sink, wider island appetite, more barn-eating endgame cards). Reported ' +
    'against island.levelRules.{}.cardsPerCrate, which ticket 14 settled at 2/3/3.',
  measure({ pooled }) {
    const middle = median(
      pooled.ended.map((g) => thirdMedian(g.barnByRound, 'middle')).filter(Number.isFinite),
    );
    const last = median(
      pooled.ended.map((g) => thirdMedian(g.barnByRound, 'last')).filter(Number.isFinite),
    );
    const value = last - middle;
    const bySeat = pooled.bySeats.map((s) => {
      const m = median(
        s.ended.map((g) => thirdMedian(g.barnByRound, 'middle')).filter(Number.isFinite),
      );
      const l = median(
        s.ended.map((g) => thirdMedian(g.barnByRound, 'last')).filter(Number.isFinite),
      );
      return `${s.seats}p ${num(m, 1)} -> ${num(l, 1)}`;
    });
    return {
      value,
      headline: `median barn ${num(middle, 1)} in the middle third, ${num(last, 1)} in the last (${
        value > 0 ? '+' : ''
      }${num(value, 1)})`,
      detail: [`by seat count, middle -> last: ${bySeat.join('  ')}`],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 0 ? 'FAIL' : 'PASS',
    };
  },
};
