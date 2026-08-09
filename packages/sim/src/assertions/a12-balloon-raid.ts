import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, num, pct, separated, meanInterval } from '../stats.js';

/**
 * Added by ticket 06 ruling J. Moving a balloon costs 2 barn cards and the
 * raided player receives NOTHING, so unlike the visit fee it is a pure take:
 * the same "reverse engine-building" resentment shape as assertion 2, on a
 * different mechanism, and consciously accepted at the time.
 *
 * The measurement has to be careful about the direction of causation. A seat
 * that scores badly may attract raids rather than suffer from them, so a raw
 * score gap is not proof. What is reported is the gap AND whether it is
 * separated from noise; the interpretation stays with the reader, which is what
 * OBSERVE means.
 *
 * ⚠️ RE-READ IT SINCE THE VEGETABLE REBUILD (2026-08-09), and this is a change
 * of MEANING rather than of arithmetic. "Uncompensated" is no longer the whole
 * truth: V16 The Market Signal Tower pays its owner £2 whenever a neighbour
 * takes a balloon from their Aerodrome, and V19 The Market Gazette pays 2 VP
 * for every balloon still parked there at game end - so being raided is now
 * deliberately profitable for a seat that has bought either, and being raided
 * off a fleet is deliberately expensive for one holding V19. A gap here that
 * used to read as "the raid hurts" can now read as "the raided seat had not
 * bought the Tower", which is a card question rather than a rule question.
 * The assertion still measures the right thing and its verdict is still
 * OBSERVE; what changed is what an answer means, so the detail line below
 * reports the two cards' presence alongside the gap.
 */
export const balloonRaid: Assertion = {
  id: 12,
  title: 'Balloon raid compensation',
  quote:
    'The uncompensated raid was raised against the BGG resentment research and consciously ' +
    'accepted. It goes on the sim watch list.',
  source: 'ticket 06 ruling J',
  shape: "Raid frequency, and raided seats' final scores against never-raided seats.",
  threshold:
    'OBSERVE - a score gap here can run either way causally, so it reports and does not judge',
  taste: false,
  remedy: NO_REMEDY,
  measure({ pooled }) {
    const withBalloons = pooled.ended.filter(
      (g) => g.suits.includes('vegetable') || g.neutral.includes('vegetable'),
    );
    let raids = 0;
    const raided: number[] = [];
    const safe: number[] = [];
    for (const g of withBalloons) {
      raids += g.raidsByVictim.reduce((a, b) => a + b, 0);
      for (let seat = 0; seat < g.seats; seat++) {
        const total = g.scores[seat]?.total ?? NaN;
        if (!Number.isFinite(total)) continue;
        if ((g.raidsByVictim[seat] ?? 0) > 0) raided.push(total);
        else safe.push(total);
      }
    }
    const gap = mean(raided) - mean(safe);
    const clear = separated(meanInterval(raided), meanInterval(safe));
    // The two cards that deliberately make being raided pay (the Vegetable
    // rebuild). Counted so the gap is never read as a pure rule effect while
    // either of them is on the table.
    let towers = 0;
    let gazettes = 0;
    for (const g of withBalloons) {
      if ((g.cards.get('V16')?.played ?? false) === true) towers += 1;
      if ((g.cards.get('V19')?.played ?? false) === true) gazettes += 1;
    }
    return {
      value: gap,
      headline:
        `${num(withBalloons.length === 0 ? NaN : raids / withBalloons.length, 2)} raids per game ` +
        `with the Aerodrome in play; raided seats score ${num(mean(raided), 1)} against ` +
        `${num(mean(safe), 1)} (${gap > 0 ? '+' : ''}${num(gap, 1)})`,
      detail: [
        `${raided.length} raided seat-games, ${safe.length} never raided; ` +
          (clear ? 'the means ARE separated at 95%' : 'the means are not separated at 95%'),
        `total balloon moves ${withBalloons.reduce((a, g) => a + g.balloonMoves, 0)}, of which ` +
          `${pct(
            raids === 0
              ? NaN
              : raids /
                  Math.max(
                    1,
                    withBalloons.reduce((a, g) => a + g.balloonMoves, 0),
                  ),
          )} were raids on a seat rather than takes from the centre`,
        `V16 The Market Signal Tower built in ${pct(
          withBalloons.length === 0 ? NaN : towers / withBalloons.length,
        )} of these games and V19 The Market Gazette in ${pct(
          withBalloons.length === 0 ? NaN : gazettes / withBalloons.length,
        )} - both make being raided pay, so read the gap against them rather than as a pure rule effect`,
      ],
      verdict: 'OBSERVE',
    };
  },
};
