import type { Assertion } from './types.js';
import { median, num, pct } from '../stats.js';

/**
 * Watch-list 3, REWRITTEN for the suit Services (2026-08-10).
 *
 * The old bootstrap was "the Fair cannot open until someone takes three plain
 * £1 visits". There is no Fair and no £3 fee: every seat owns its Service from
 * setup. But the bootstrap did not vanish, it got cheaper and moved - a seat
 * starts on £0 and its own Service costs `workers.ownerActivationCost`, so it
 * cannot run its own farm until it has taken income, and income means visiting
 * somebody. That is the hook stated as an arithmetic, and this is the assertion
 * that checks the arithmetic actually bites early rather than never.
 *
 * A LATE first own-activation is not automatically bad here (it can mean the
 * seat is spending its bonus slot on neighbours, which is the point). A first
 * activation that never happens at all is the failure: it means the £1 is
 * unreachable and the Service is the owner's in name only.
 */
export const bootstrap: Assertion = {
  id: 3,
  title: 'Bootstrap',
  quote:
    'Everyone starts at £0 and their own Service costs £1, so the money to run your own farm ' +
    'has to come from a neighbour first. Metric: turn of the first own-Service activation.',
  source: 'docs/Unified Visit v14.md section 7.3, rewritten for the Services',
  shape: "Median of each seat's own turn number when it first activates its own Service.",
  threshold: 'FAIL if under half of seats ever activate their own Service',
  taste: false,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/service-free-own.overlay.json   ' +
    '(workers.ownerActivationCost 0; the fallback named in the design is seeding starting ' +
    'coins, rules.setup.startingCoins, which has never been adopted)',
  measure({ pooled }) {
    const turns: number[] = [];
    let seatsThatDid = 0;
    let seatsTotal = 0;
    for (const g of pooled.ended) {
      for (let seat = 0; seat < g.seats; seat++) {
        seatsTotal += 1;
        const t = g.firstOwnServiceTurnBySeat[seat];
        if (t !== null && t !== undefined) {
          turns.push(t);
          seatsThatDid += 1;
        }
      }
    }
    const share = seatsTotal === 0 ? NaN : seatsThatDid / seatsTotal;
    return {
      value: median(turns),
      headline: `median first own-Service use on turn ${num(median(turns), 1)} (${pct(
        share,
      )} of seats ever use their own)`,
      detail: [
        `${turns.length} first-uses observed across ${pooled.ended.length} ended games`,
        'A late median is not a failure on its own - a seat spending its bonus slot on ' +
          'neighbours instead is the behaviour the design wants. Never using it is the failure.',
      ],
      verdict: !Number.isFinite(share) ? 'OBSERVE' : share < 0.5 ? 'FAIL' : 'PASS',
    };
  },
};
