import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { tailSeries } from './lib.js';
import { changePerStep, num } from '../stats.js';

/**
 * Watch-list 1. The design states this one as a shape outright - "must plateau,
 * not climb" - so it needs no invented level, only a definition of climb.
 *
 * Two slopes, because the pile can climb in two directions: WITHIN a game and
 * ACROSS seat counts. Ticket 28's probes are the reason both are here: mixed
 * scored tables ended on £46/£33/£31 (flat, even falling) while undirected
 * mirrors of the same engine reproduced £63/£159/£220, so a measurement that
 * only looked one way could have called either.
 *
 * ## Two things ticket 44 changed, and why
 *
 * **It measures coins, not percentages.** A ratio is read against the level it
 * sits on, and re-scoring the whole report archive showed the metric running
 * backwards: reference-v1 - the run whose headline was "coins plateau" - PASSED
 * at 6.6% a step while climbing **£1.75 a round** on a £24 pile, while
 * reference-v5 FAILED at 21.3% while climbing **£0.33** on a £5 pile. Ticket 43
 * then added a working coin sink, cut the pile by a third, changed the absolute
 * climb not at all, and flipped the verdict to FAIL for doing so.
 *
 * **It excludes the final round.** Every reference, every seat count, shows the
 * same +£2 to +£3 jump in the last round: the end-trigger delivery mint landing
 * with no turns left to spend it. That is the shape of the ending, not the
 * health of the economy, and since coins score nothing (2026-08-03) the pile a
 * game finishes on buys precisely nothing. It is still printed, as its own line.
 *
 * ## Where the £1 comes from
 *
 * Ticket 11's rule: a threshold is cited design intent expressed as shape, never
 * our own output. v14: *"every turn you convert 1 spare card into either £1 or a
 * second action"*, and the base visit wage is £1. One turn per player per round,
 * so **£1 per player per round is a whole turn's minting banked and never
 * spent** - the faucet running straight into the pile. Above that it is not a
 * plateau by the design's own arithmetic.
 *
 * The window is deliberately still the last 5 rounds, so any archived report can
 * be re-scored by hand from the series it already prints - which is why both
 * series print to a decimal place (ticket 50). They are MEDIANS, so a half is
 * ordinary, and rounding them to whole pounds made the headline unreproducible
 * from the detail: a run printing "£5 / £6 / £7" scored 1.25, off 4.5 / 6.0 / 7.0.
 */
export const coinFlood: Assertion = {
  id: 1,
  title: 'Coin flood',
  quote: 'Table coins at the end of each round must plateau, not climb.',
  source: 'docs/Unified Visit v14.md section 7.1',
  shape:
    'Mean absolute change in the median end-of-round coin pile, over the last 5 rounds with the ' +
    'final round excluded (the end trigger mints into it with no turns left to spend), and ' +
    'across seat counts.',
  threshold:
    'FAIL if either climbs by more than £1 per step - one turn of minting banked and never spent',
  taste: false,
  remedy:
    `${NO_REMEDY}. The design's nearest lever is assertion 2's wage overlay ` +
    '(overlays/wage-shrink.overlay.json), and the pity-rate knob rules.economy.coinPityDivisor, ' +
    'which the design flags OPEN rather than prescribing.',
  measure({ pooled }) {
    const bySeat = pooled.bySeats.map((slice) => {
      const series = tailSeries(slice.ended, 5, (g) => g.coinsByRound);
      const plateau = series.slice(0, -1);
      const last = series[series.length - 1];
      const previous = series[series.length - 2];
      return {
        seats: slice.seats,
        series,
        plateau,
        slope: changePerStep(plateau),
        // What the end trigger itself adds, excluded above and printed below.
        endMint: last === undefined || previous === undefined ? NaN : last - previous,
      };
    });

    // Across seat counts, measured at the same place: the pile entering the
    // final round, so neither leg is reading the end-trigger mint.
    const acrossSeries = bySeat.map((s) => s.plateau[s.plateau.length - 1] ?? NaN);
    const acrossSlope = changePerStep(acrossSeries);

    const finite = [...bySeat.map((s) => s.slope), acrossSlope].filter((x) => Number.isFinite(x));
    const worst = finite.length === 0 ? NaN : Math.max(...finite);

    return {
      value: worst,
      headline:
        `steepest climb £${num(worst, 2)} per step ` +
        `(within-game ${bySeat.map((s) => `£${num(s.slope, 2)}`).join(' / ')}, ` +
        `across seat counts £${num(acrossSlope, 2)})`,
      detail: [
        ...bySeat.map(
          (s) =>
            `${s.seats}p last 5 rounds, median coins: ${s.series.map((v) => num(v, 1)).join(' -> ')}` +
            ` (the last step, £${num(s.endMint, 1)}, is the end-trigger mint and is excluded)`,
        ),
        `entering the final round, by seat count: ${acrossSeries.map((v) => `£${num(v, 1)}`).join(' / ')}`,
      ],
      verdict: !Number.isFinite(worst) ? 'OBSERVE' : worst > 1 ? 'FAIL' : 'PASS',
    };
  },
};
