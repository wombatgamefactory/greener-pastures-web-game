import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { median, num, pct } from '../stats.js';

/**
 * Watch-list 3, and the assertion that proved ticket 11's own rule on the first
 * pass: **its prescribed remedy has already been spent.**
 *
 * The design says "Fixes in order: hire £2 ... then seed £1-2", and
 * `workers.hireFee` already reads 2, adopted 2026-07-21. So if this fails there
 * is no prescribed fix left, and the remedy field says exactly that rather than
 * inventing `hireFee: 1`. Seeding starting coins is named in the design as the
 * NEXT fix but has never been adopted, so it is offered as the design's own
 * words and not as our recommendation.
 */
export const bootstrap: Assertion = {
  id: 3,
  title: 'Bootstrap',
  quote:
    'The Fair cannot open until someone takes three plain £1 visits - three near-identical ' +
    'opening turns before the interesting economy switches on. Metric: turn of the first hire. ' +
    "If it's turn 4+, dial.",
  source: 'docs/Unified Visit v14.md section 7.3',
  shape: "Median of each seat's own turn number when it first hires.",
  threshold: 'FAIL at turn 4 or later',
  taste: false,
  remedy:
    `${NO_REMEDY} left. The design prescribes "hire £2" first, and workers.hireFee is ALREADY 2 ` +
    '(adopted 2026-07-21). Its named next step is to seed £1-2 of starting coins ' +
    '(rules.setup.startingCoins), which has never been adopted and is not prescribed here.',
  measure({ pooled }) {
    const turns: number[] = [];
    let seatsThatHired = 0;
    let seatsTotal = 0;
    for (const g of pooled.ended) {
      for (let seat = 0; seat < g.seats; seat++) {
        seatsTotal += 1;
        const t = g.firstHireTurnBySeat[seat];
        if (t !== null && t !== undefined) {
          turns.push(t);
          seatsThatHired += 1;
        }
      }
    }
    const value = median(turns);
    return {
      value,
      headline: `median first hire on turn ${num(value, 1)} (${pct(
        seatsTotal === 0 ? NaN : seatsThatHired / seatsTotal,
      )} of seats ever hire)`,
      detail: [`${turns.length} hires observed across ${pooled.ended.length} ended games`],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value >= 4 ? 'FAIL' : 'PASS',
    };
  },
};
