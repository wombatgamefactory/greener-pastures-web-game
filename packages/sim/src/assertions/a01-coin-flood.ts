import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { endCoins, tailSeries } from './lib.js';
import { growthPerStep, num, pct } from '../stats.js';

/**
 * Watch-list 1. The design states this one as a shape outright - "must plateau,
 * not climb" - so it needs no invented level, only a definition of climb.
 *
 * Two slopes, because the pile can climb in two directions: WITHIN a game (the
 * last five rounds) and ACROSS seat counts. Ticket 28's probes are the reason
 * both are here: mixed scored tables ended on £46/£33/£31 (flat, even falling)
 * while undirected mirrors of the same engine reproduced £63/£159/£220, so a
 * measurement that only looked one way could have called either.
 */
export const coinFlood: Assertion = {
  id: 1,
  title: 'Coin flood',
  quote: 'Table coins at the end of each round must plateau, not climb.',
  source: 'docs/Unified Visit v14.md section 7.1',
  shape:
    'Mean per-step growth of the median end-of-round coin pile, over the last 5 rounds and ' +
    'across seat counts.',
  threshold: 'FAIL if either slope exceeds +15% per step',
  taste: false,
  remedy:
    `${NO_REMEDY}. The design's nearest lever is assertion 2's wage overlay ` +
    '(overlays/wage-shrink.overlay.json), and the pity-rate knob rules.economy.coinPityDivisor, ' +
    'which the design flags OPEN rather than prescribing.',
  measure({ pooled }) {
    const withinBySeat = pooled.bySeats.map((slice) => ({
      seats: slice.seats,
      series: tailSeries(slice.ended, 5, (g) => g.coinsByRound),
    }));
    const withinSlopes = withinBySeat.map((s) => growthPerStep(s.series));
    const acrossSeries = pooled.bySeats.map((slice) => endCoins(slice.ended));
    const acrossSlope = growthPerStep(acrossSeries);

    const finite = [...withinSlopes, acrossSlope].filter((x) => Number.isFinite(x));
    const worst = finite.length === 0 ? NaN : Math.max(...finite);

    return {
      value: worst,
      headline: `steepest slope ${pct(worst)} per step (within-game ${withinSlopes
        .map((s) => pct(s))
        .join(' / ')}, across seat counts ${pct(acrossSlope)})`,
      detail: [
        ...withinBySeat.map(
          (s) =>
            `${s.seats}p last 5 rounds, median coins: ${s.series.map((v) => num(v, 0)).join(' -> ')}`,
        ),
        `end coins by seat count: ${acrossSeries.map((v) => `£${num(v, 0)}`).join(' / ')}`,
      ],
      verdict: !Number.isFinite(worst) ? 'OBSERVE' : worst > 0.15 ? 'FAIL' : 'PASS',
    };
  },
};
