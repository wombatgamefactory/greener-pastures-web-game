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
      ],
      verdict: 'OBSERVE',
    };
  },
};
