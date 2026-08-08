import type { Assertion } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 4, replaced for the suit Services (2026-08-10) and RE-BASED against
 * real data on 2026-08-09.
 *
 * The old assertion asked whether the top of the Working Week track ever sold.
 * There is no track. What replaced it as the brake on a popular farm is the
 * Service's own THRESHOLD: every rival use puts a card on it, and when it fills
 * it clogs until the owner spends a Harvest action on it.
 *
 * THE RE-BASE, and it is an instrument correction worth reading. The first
 * version of this assertion FAILed above 25%, a number invented the day the
 * Services landed with nothing behind it. Three paired n=1580 arms then measured
 * the threshold as the only lever that has ever moved the suit balance, and the
 * arm that fixes the game is the one that trips the old band:
 *
 *   threshold 4 -> 8.6% clogged, Orchard wins 80.8%
 *   threshold 3 -> 20.6% clogged, Orchard wins 62.8%
 *   threshold 2 -> 39.6% clogged, Orchard wins 42.0%   <- shipped
 *
 * So a high clog rate is the brake WORKING, not the brake hurting, and the band
 * had it backwards. What the same three arms also show is that clog does not
 * predict denial: the share of turns beginning with cards and no legal visit
 * anywhere moved 0.4% -> 0.5% -> 0.6% across them, because there is always
 * another Notice Board or another Service to go to. Clog means "I cannot have
 * the action I wanted", which is a race; denial means "I cannot interact", which
 * is a lock. Assertion 5 owns the lock. This one owns the brake.
 *
 * Hence a FLOOR, not a ceiling. Too LOW is the failure: a Service that never
 * fills is an unlimited action tap whose owner collects freight for nothing, and
 * that is exactly the state the game was in at threshold 4 when one suit won
 * four games in five. The high end is reported and not judged, because whether a
 * shop shut two turns in five reads as a race worth losing or as an irritation
 * is a table question and this instrument cannot answer it.
 */

/** Below this the brake is not biting. Set from the t=4 arm, which measured 8.6% and was broken. */
const BRAKE_FLOOR = 0.15;
/** Above this, report loudly. Not a FAIL: only a table can judge how a shut shop feels. */
const FEEL_WATCH = 0.5;

export const serviceClog: Assertion = {
  id: 4,
  title: 'The Service clog',
  quote:
    'The Service threshold is the only brake on a popular farm, and the only lever ever ' +
    'measured to move the suit balance. Too low and it never bites.',
  source: 'the suit Services, 2026-08-10; band re-based against the threshold arms 2026-08-09',
  shape: "Share of turn boundaries at which a seat's own Service stands clogged.",
  threshold: `FAIL below ${pct(BRAKE_FLOOR)}; above ${pct(FEEL_WATCH)} reports as a table question`,
  taste: false,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/service-threshold.sweep.json   ' +
    '(workers.serviceThreshold 1/2/3/4; the pre-lock control is overlays/service-loose.overlay.json)',
  measure({ pooled }) {
    let clogged = 0;
    let sampled = 0;
    for (const g of pooled.ended) {
      for (let seat = 0; seat < g.seats; seat++) {
        clogged += g.serviceClogTurnsBySeat[seat] ?? 0;
        sampled += g.serviceClogSampledBySeat[seat] ?? 0;
      }
    }
    const value = sampled === 0 ? NaN : clogged / sampled;
    const detail = [
      `${clogged} clogged samples across ${pooled.ended.length} ended games`,
      'A clogged Service refuses visits, so this is the rate at which the busiest farm on the ' +
        'island is shut. It is NOT the denial rate - assertion 5 owns that, and across the ' +
        'threshold arms denial barely moved (0.4% / 0.5% / 0.6%) while this tripled.',
    ];
    if (value > FEEL_WATCH) {
      detail.push(
        `Above ${pct(FEEL_WATCH)}: the shop is shut more often than it is open. Reported, not ` +
          'judged - whether that is a race worth losing or an irritation is a table question.',
      );
    }
    return {
      value,
      headline: `${pct(value)} of ${sampled} turn boundaries find a seat's Service clogged`,
      detail,
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < BRAKE_FLOOR ? 'FAIL' : 'PASS',
    };
  },
};
