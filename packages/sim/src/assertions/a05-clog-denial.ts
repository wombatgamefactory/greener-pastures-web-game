import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 5. The Notice Board is the only visit target in the game, so a
 * full board blocks the whole of a farm's cross-table surface at once, and a
 * leader can sit on it.
 *
 * Sampled at the START of a turn, holding cards. Both conditions matter: once
 * the bonus slot is spent there are no visits for a reason that is not denial,
 * and a seat with an empty hand has nothing to visit WITH, which is a card
 * problem rather than a clog.
 *
 * ⭐ v31 GIVES THIS NUMBER A SECOND CAUSE, and the two are not distinguishable
 * from the outside, which is worth knowing before it is read. "No visit is
 * legal anywhere" used to mean one thing: every board is full. It can now also
 * mean **every open door has nothing legal to do for me**, because a dead door
 * is not offered (`workerActionLegal`) - the Wheat door with nothing full to
 * harvest, the Vegetable door with an empty barn, the Dairy door with nothing
 * affordable. At 2 seats there are only two boards and one of them is your own,
 * so a seat can be shut out by arithmetic rather than by anybody's traffic. A
 * high reading here with a LOW clog rate (assertion 4) is that second cause,
 * and it is a door-design question rather than a denial question.
 *
 * The threshold survives unchanged because the design's sentence does: what it
 * is measuring is still "I am holding cards and cannot interact". The self-visit
 * is included in "legal anywhere" deliberately - a seat that can still feed its
 * own board has an option, even a solitaire one.
 *
 * The design floats a dial - the Notice Board threshold to 4 at two seats - but
 * has never adopted it, so it is noted in rules.json's `unresolved` and is NOT
 * prescribed here. Ticket 11's rule: never an invented remedy.
 */
export const clogDenial: Assertion = {
  id: 5,
  title: 'Clog as denial',
  quote:
    'A full Notice Board blocks visits, and it is the only visit target in the game. Mostly ' +
    'self-correcting. But a leader CAN sit on a full board to lock rivals out of the action ' +
    'they need. Watch at 2p specifically. [02/09/2026] A clogged Notice Board at 2 players is ' +
    'total denial rather than a race.',
  source: 'docs/Unified Visit v14.md section 7.4; rules.json meta.unresolved, on the 2-seat game',
  shape: 'Share of turns begun holding cards on which no visit is legal anywhere, by seat count.',
  threshold: 'FAIL above 15% at 2 seats',
  taste: false,
  remedy:
    `${NO_REMEDY}. The threshold-4-at-2p dial is recorded as unadopted in rules.json and is ` +
    'deliberately not offered as a fix. Read it beside assertion 4 first: a high reading here ' +
    'with a low clog rate is not denial at all, it is doors with nothing legal to do.',
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
      detail: [
        ...rows.map((r) => `${r.seats}p: ${r.sampled} turns sampled`),
        'Two causes, indistinguishable here: every board full, or every open door with nothing ' +
          'legal to do for this seat. Assertion 4 tells them apart - a high reading here with a ' +
          'low clog rate there is the second, which is a door-design question.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 0.15 ? 'FAIL' : 'PASS',
    };
  },
};
