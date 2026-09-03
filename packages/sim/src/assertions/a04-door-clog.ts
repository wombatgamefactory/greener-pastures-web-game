import type { Assertion } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 4, and the assertion in this suite that has been re-based most
 * often - three times now, each because the thing underneath it changed
 * meaning rather than because the number was inconvenient.
 *
 * ⛔ THE FILE IS NAMED a04-door-clog SINCE 02/09/2026. It was
 * `a04-track-cherry-picking` for a Working Week that has not existed since
 * 2026-08-10, and the stale name was still pointing readers at a track. The
 * remedy field pointed at `workers.serviceThreshold` and
 * `overlays/service-loose.overlay.json` for just as long, and BOTH ARE DELETED:
 * the knob is `rules.economy.noticeBoardThreshold` and the paired arm is
 * `overlays/noticeboard-threshold-3.overlay.json`.
 *
 * ## What it measures, and why a FLOOR rather than a ceiling
 *
 * The board's threshold is the only brake in the game on a popular farm. Every
 * card placed on a Notice Board fills it, and when it is full it clogs until
 * the owner spends a Harvest action clearing it into their own barn. A high
 * clog rate is the brake WORKING, not the brake hurting, and the first version
 * of this assertion had the band backwards - it failed ABOVE 25%, a number
 * invented the day the Services landed with nothing behind it.
 *
 * Three paired n=1580 arms then measured the threshold as the only lever ever
 * shown to move the suit balance, and the arm that fixed the game was the one
 * that tripped the old band:
 *
 *   threshold 4 -> 8.6% clogged, Orchard wins 80.8%
 *   threshold 3 -> 20.6% clogged, Orchard wins 62.8%
 *   threshold 2 -> 39.6% clogged, Orchard wins 42.0%
 *
 * Those numbers were taken on a TWO-BUILDING surface (a Notice Board and a
 * Service). Change 6 (20/08/2026) merged them, which re-based the metric again -
 * it used to mean "half this farm is shut" and now means "this farm is shut" -
 * and on the single-door surface at n=500 it read t=5 -> 2.3%, t=3 -> 5.0%,
 * t=2 -> 11.0%.
 *
 * ⭐ AND v31 RE-BASES IT A THIRD TIME, WITHOUT CHANGING A LINE OF THE
 * ARITHMETIC. The same two spaces now absorb a third kind of traffic: a seat
 * may place its own bonus card on its OWN board, so the clog is the only brake
 * on the solitaire door as well as on the busy one. Nothing has ever measured
 * the threshold doing that job. Read this number beside assertion 17's
 * self-visit share: if self-visiting is common AND the clog rate is high, the
 * brake is what is holding the hook up, and the shipped 2 is doing exactly what
 * it was ruled to do.
 *
 * THE FLOOR IS DERIVED BY THE SAME RULE EACH TIME: sit above the clog rate of
 * the arms that are measurably broken and below the arm that was chosen. The
 * 2026-08-09 band put 15% above a broken 8.6% and below a shipped 39.6%; the
 * merged-door band put 8% above a broken 2.3% and 5.0% and below the ruled
 * 11.0%. The 8% is CARRIED UNCHANGED into v31 rather than re-derived, because
 * re-deriving it would mean setting it from this run's own output, and the new
 * traffic can only push the rate up.
 *
 * ⚠️ IT IS STILL A NUMBER TAKEN FROM OUR OWN OUTPUT, which is the weakest kind
 * of threshold this project allows and the bar ticket 11 section 2 warns about.
 * It is kept because the design's sentence - "too low and it never bites" -
 * names a direction and no number, so something has to stand in for "bites".
 * Treat it as a tripwire for the brake vanishing, never as a target to tune the
 * threshold towards: the threshold is ruled on SUIT BALANCE, and this band
 * exists to notice when the brake has quietly stopped existing, which is
 * exactly what it did at t=5.
 */
const BRAKE_FLOOR = 0.08;
/** Above this, report loudly. Not a FAIL: only a table can judge how a shut shop feels. */
const FEEL_WATCH = 0.5;

export const doorClog: Assertion = {
  id: 4,
  title: 'The door clog',
  quote:
    'The Notice Board threshold is the only brake on a popular farm, and the only lever ever ' +
    'measured to move the suit balance. Too low and it never bites. [02/09/2026] In v31 it ' +
    'throttles a third kind of traffic as well - your own self-visits - so the same 2 is doing ' +
    'more work than any arm has measured it doing.',
  source:
    'the suit Services, 2026-08-10; band re-based against the threshold arms 2026-08-09, again ' +
    'on 20/08/2026 when change 6 merged the door into the Notice Board, and re-read for ' +
    'self-visit traffic on 02/09/2026 (rules.json, noticeBoardThreshold)',
  shape: "Share of turn boundaries at which a seat's own Notice Board stands clogged.",
  threshold: `FAIL below ${pct(BRAKE_FLOOR)}; above ${pct(FEEL_WATCH)} reports as a table question`,
  taste: false,
  remedy:
    'npm run sim -- --watchlist --overlay=overlays/noticeboard-threshold-3.overlay.json   ' +
    '(rules.economy.noticeBoardThreshold 3 against the shipped 2; the third candidate is 4, ' +
    "which is unarmed and not refuted - Dean's argument for it is that a tile costs 4 cards, so " +
    "a door at 4 holds exactly one delivery's worth of freight)",
  measure({ pooled }) {
    let clogged = 0;
    let sampled = 0;
    for (const g of pooled.ended) {
      for (let seat = 0; seat < g.seats; seat++) {
        clogged += g.doorClogTurnsBySeat[seat] ?? 0;
        sampled += g.doorClogSampledBySeat[seat] ?? 0;
      }
    }
    const value = sampled === 0 ? NaN : clogged / sampled;
    const detail = [
      `${clogged} clogged samples across ${pooled.ended.length} ended games`,
      'A clogged board refuses every visit, the owner’s own included, so this is the rate ' +
        'at which the busiest farm on the island is shut. It is NOT the denial rate - assertion ' +
        '5 owns that, and across the threshold arms denial barely moved (0.4% / 0.5% / 0.6%) ' +
        'while this tripled.',
      'Read it beside assertion 17’s self-visit share. The clog is the ONLY brake on the ' +
        'solitaire door, so a high self-visit share with a low clog rate means the brake is not ' +
        'reaching the thing it was ruled to hold back.',
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
