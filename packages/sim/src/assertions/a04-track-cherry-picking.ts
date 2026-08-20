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

/**
 * ⭐ RE-BASED AGAIN, 20/08/2026, FOR CHANGE 6, and the re-base is not optional:
 * the metric underneath it changed meaning, so the old number measured nothing.
 *
 * It used to sample the SERVICE - one of two rival-touchable buildings - and
 * meant *"half this farm is shut"*. Since the merge it samples the NOTICE
 * BOARD, the only door, and means *"this farm is shut"*. One threshold now
 * throttles the traffic that used to split across two buildings, so the rates
 * are not comparable and 15% is unreachable: **no threshold in the sensible
 * range gets near it.**
 *
 *   merged door, t=5 -> 2.3% clogged, suits 70.2 points from even
 *   merged door, t=3 -> 5.0% clogged, suits 67.2 points from even
 *   merged door, t=2 -> 11.0% clogged, suits 54.6 points from even   <- ruled
 *
 * THE FLOOR IS DERIVED BY THE SAME RULE AS THE OLD ONE: sit above the clog rate
 * of the arms that are measurably broken and below the arm that is chosen. The
 * 2026-08-09 band put 15% above a broken 8.6% and below a shipped 39.6%; this
 * one puts 8% above a broken 2.3% and 5.0% and below the ruled 11.0%.
 *
 * ⚠️ AND IT IS STILL A NUMBER TAKEN FROM OUR OWN OUTPUT, which is the weakest
 * kind of threshold this project allows and the bar ticket 11 section 2 warns
 * about. It is kept because the design's sentence - *"too low and it never
 * bites"* - names a direction and no number, so something has to stand in for
 * "bites". Treat it as a tripwire for the brake vanishing, never as a target to
 * tune the threshold towards: the threshold is ruled on SUIT BALANCE, and this
 * band exists to notice when the brake has quietly stopped existing, which is
 * exactly what it did at t=5.
 */
const BRAKE_FLOOR = 0.08;
/** Above this, report loudly. Not a FAIL: only a table can judge how a shut shop feels. */
const FEEL_WATCH = 0.5;

export const serviceClog: Assertion = {
  id: 4,
  title: 'The door clog',
  quote:
    'The Service threshold is the only brake on a popular farm, and the only lever ever ' +
    'measured to move the suit balance. Too low and it never bites.',
  source:
    'the suit Services, 2026-08-10; band re-based against the threshold arms 2026-08-09, and ' +
    'again 20/08/2026 when change 6 merged the door into the Notice Board',
  shape: "Share of turn boundaries at which a seat's own Notice Board stands clogged.",
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
      headline: `${pct(value)} of ${sampled} turn boundaries find a seat's Notice Board clogged`,
      detail,
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < BRAKE_FLOOR ? 'FAIL' : 'PASS',
    };
  },
};
