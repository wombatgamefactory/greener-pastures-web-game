import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 5. Under v14 the Notice Board is the only visit target in the
 * game, so a full board does not merely block a £1 - it blocks access to the
 * owner's Hired Worker too, and a leader can sit on it.
 *
 * Sampled at the START of a turn, holding cards. Both conditions matter: once
 * the bonus slot is spent there are no visits for a reason that is not denial,
 * and a seat with an empty hand has nothing to visit WITH, which is a card
 * problem rather than a clog.
 *
 * The design floats a dial - the Notice Board threshold to 4 at two seats - but
 * has never adopted it, so it is noted in rules.json's `unresolved` and is NOT
 * prescribed here. Ticket 11's rule: never an invented remedy.
 */
export const clogDenial: Assertion = {
  id: 5,
  title: 'Clog as denial',
  quote:
    "A full Notice Board blocks visits - which now blocks access to the owner's Hired Worker " +
    'too. Mostly self-correcting. But a leader CAN sit on a full board to lock rivals out of a ' +
    'Worker they need. Watch at 2p specifically.',
  source: 'docs/Unified Visit v14.md section 7.4',
  shape: 'Share of turns begun holding cards on which no visit is legal anywhere, by seat count.',
  threshold: 'FAIL above 15% at 2 seats',
  taste: false,
  remedy:
    `${NO_REMEDY}. The threshold-4-at-2p dial is recorded as unadopted in rules.json and is ` +
    'deliberately not offered as a fix.',
  measure({ pooled }) {
    const rows = pooled.bySeats.map((slice) => {
      let sampled = 0;
      let clogged = 0;
      for (const g of slice.ended) {
        for (let seat = 0; seat < g.seats; seat++) {
          sampled += g.clogSampledBySeat[seat] ?? 0;
          clogged += g.clogTurnsBySeat[seat] ?? 0;
        }
      }
      return { seats: slice.seats, rate: sampled === 0 ? NaN : clogged / sampled, sampled };
    });
    const twoSeat = rows.find((r) => r.seats === 2);
    const value = twoSeat?.rate ?? NaN;
    return {
      value,
      headline: `${rows.map((r) => `${r.seats}p ${pct(r.rate)}`).join('  ')} of turns begin with cards and no legal visit`,
      detail: rows.map((r) => `${r.seats}p: ${r.sampled} turns sampled`),
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 0.15 ? 'FAIL' : 'PASS',
    };
  },
};
