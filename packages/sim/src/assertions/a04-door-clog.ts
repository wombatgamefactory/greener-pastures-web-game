import { isMeepleCurrency } from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { num, pct } from '../stats.js';

/**
 * Watch-list 4, and the assertion in this suite that has been re-based most
 * often - four times now, each because the thing underneath it changed meaning
 * rather than because the number was inconvenient.
 *
 * ⛔ THE FILE IS NAMED a04-door-clog SINCE 02/09/2026. It was
 * `a04-track-cherry-picking` for a Working Week that has not existed since
 * 2026-08-10, and the stale name was still pointing readers at a track. The
 * remedy field pointed at `workers.serviceThreshold` and
 * `overlays/service-loose.overlay.json` for just as long, and BOTH ARE DELETED:
 * the knob is `rules.economy.noticeBoardThreshold` and the paired arm is
 * `overlays/noticeboard-threshold-3.overlay.json`.
 *
 * ## What it measures under the shipped game, and why a FLOOR rather than a ceiling
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
 * ⭐ AND v31 RE-BASED IT A THIRD TIME, WITHOUT CHANGING A LINE OF THE
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
 *
 * ## ⭐⭐ THE FOURTH RE-BASE: SLOTS, NOT A THRESHOLD (the meeple-loop arm, 04/09/2026)
 *
 * Under `rules.turn.visitCurrency: 'meeple'` the Notice Board **is not a
 * building** (R5). It has no threshold, no stack and no harvest; it is five
 * colour-keyed slots, and a slot is blocked while any meeple sits in it (R6).
 * `isFull` on that card is false for the whole game, so the arithmetic above
 * would report a flat 0% for a board that can be completely shut - a perfect
 * score for a question that had stopped being asked, which is exactly the
 * failure this assertion's neighbour (a05) suffered on 03/09/2026 and the reason
 * the arm is branched here rather than left to read through a dead predicate.
 *
 * What is measured under the arm is the same SENTENCE about a different object,
 * and two numbers rather than one:
 *
 *   FULL-BOARD RATE   turn boundaries at which all five of a seat's slots are
 *                     blocked - this farm is shut to the whole table
 *   SLOT OCCUPANCY    blocked slots over slots sampled, five per seat
 *
 * Both are reported because neither can stand alone: a table at 20% occupancy
 * and a table at 80% can show the same near-zero full-board rate, and the
 * full-board rate is what "shut" means while occupancy is what "busy" means.
 *
 * ⛔ **THE 8% FLOOR HAS NO REFERENT UNDER THE ARM AND IS NOT REPLACED.** It was
 * a floor on a brake, and under the arm there is no brake to lose: a full board
 * is not a tax on the popular farm, it is a seat sitting on five stored actions
 * it has not banked, and X3 rules out any penalty for that. The design names no
 * number for it, the handoff names none, and one taken off this run would be a
 * snapshot test. The arm therefore ships as **OBSERVE** on this line, and the
 * question it feeds is the one the handoff actually asks - blockiness at 2
 * players, which is assertion 5's blocked-want rate, read beside these two.
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
    'more work than any arm has measured it doing. [04/09/2026, the meeple loop] Re-cut onto ' +
    'SLOTS: the full-board rate and the blocked-want rate, by seat count, 2p first.',
  source:
    'the suit Services, 2026-08-10; band re-based against the threshold arms 2026-08-09, again ' +
    'on 20/08/2026 when change 6 merged the door into the Notice Board, re-read for self-visit ' +
    'traffic on 02/09/2026 (rules.json, noticeBoardThreshold), and re-cut onto the five colour ' +
    'slots by docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5',
  shape:
    'Under visitCurrency "card": share of turn boundaries at which a seat\'s own Notice Board ' +
    'stands clogged. Under "meeple": share of turn boundaries at which all five of a seat\'s ' +
    'colour slots are blocked, with slot occupancy printed under it and both split by seat ' +
    'count, 2p first.',
  threshold:
    `Under "card": FAIL below ${pct(BRAKE_FLOOR)}; above ${pct(FEEL_WATCH)} reports as a table ` +
    'question. Under "meeple": OBSERVE. The floor was a floor on a BRAKE, and the arm has no ' +
    'brake to lose - the board has no threshold (R5), a full board is a seat holding out rather ' +
    'than a farm being taxed, and X3 rules out any penalty for it. Neither the design nor the ' +
    "handoff names a number, and one taken from this run's own output would be a snapshot test, " +
    'so the floor is deliberately not replaced.',
  taste: false,
  remedy:
    'npm run sim -- --watchlist --overlay=overlays/noticeboard-threshold-3.overlay.json   ' +
    '(rules.economy.noticeBoardThreshold 3 against the shipped 2; the third candidate is 4, ' +
    "which is unarmed and not refuted - Dean's argument for it is that a tile costs 4 cards, so " +
    "a door at 4 holds exactly one delivery's worth of freight). ⛔ THAT KNOB DOES NOTHING " +
    'UNDER THE MEEPLE-LOOP ARM, which ignores noticeBoardThreshold outright. The arm has no ' +
    'lever on this line at all: X1 rules out clearing a full board automatically and X3 rules ' +
    "out penalising the owner, so a bad reading is an argument for Dean's island alternative " +
    '(X2), which is not built and must not be.',
  measure(ctx) {
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/** The shipped v31 game, unchanged since 02/09/2026. */
function cardGame({ pooled }: MeasureContext): Measurement {
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
}

/**
 * The meeple-loop arm: the full-board rate, by seat count with 2p first, plus
 * the slot occupancy underneath it.
 *
 * 2p leads the row because it is the seat count that decides a live design
 * question (handoff section 5, item 3): at two players there is exactly ONE
 * board a seat can visit, so a shut board there is total, and Dean's fallback -
 * the island alternative for a blocked meeple, X2 - stands or falls on it.
 */
function meepleArm({ pooled }: MeasureContext): Measurement {
  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      let full = 0;
      let sampled = 0;
      let blockedSlots = 0;
      let slots = 0;
      for (const g of slice.ended) {
        for (let seat = 0; seat < g.seats; seat++) {
          full += g.doorClogTurnsBySeat[seat] ?? 0;
          sampled += g.doorClogSampledBySeat[seat] ?? 0;
        }
        blockedSlots += g.slotsBlockedAtBoundary;
        slots += g.slotsSampledAtBoundary;
      }
      return {
        seats: slice.seats,
        rate: sampled === 0 ? NaN : full / sampled,
        sampled,
        occupancy: slots === 0 ? NaN : blockedSlots / slots,
      };
    });

  let gridlock = 0;
  let gridlockSampled = 0;
  for (const g of pooled.ended) {
    gridlock += g.allBoardsFullTurns;
    gridlockSampled += g.allBoardsFullSampled;
  }

  const twoSeat = rows.find((r) => r.seats === 2);
  const value = twoSeat?.rate ?? NaN;

  return {
    value,
    headline:
      `all five slots blocked on ${rows.map((r) => `${r.seats}p ${pct(r.rate)}`).join('  ')} ` +
      'of turn boundaries (2p first: it is the seat count that decides the design question)',
    detail: [
      `slot occupancy, blocked slots over slots sampled: ${rows
        .map((r) => `${r.seats}p ${pct(r.occupancy)}`)
        .join('  ')}`,
      ...rows.map((r) => `${r.seats}p: ${r.sampled} board-boundaries sampled`),
      `every board on the table full at a turn start: ${pct(
        gridlockSampled === 0 ? NaN : gridlock / gridlockSampled,
      )} of ${gridlockSampled} turns (${gridlock}). Total gridlock of the visit economy - ` +
        'nobody has a colour free at any seat, so the bonus slot holds nothing but Collect for ' +
        'everyone at once.',
      '⭐ TWO NUMBERS, NOT ONE, AND NEITHER STANDS ALONE. The full-board rate is what "this ' +
        'farm is shut" means; occupancy is what "this farm is busy" means. A table at 20% ' +
        'occupancy and one at 80% can show the same near-zero full-board rate, so read them ' +
        'together or read neither.',
      '⛔ THE 8% FLOOR IS GONE AND IS NOT REPLACED. It was a floor on a BRAKE, and the arm has ' +
        'no brake: the board has no threshold (R5), a full board is a seat holding out on five ' +
        'stored actions rather than a popular farm being taxed, and X3 forbids penalising it. ' +
        'A number invented here would be read off our own output.',
      'Read it beside assertion 5, which owns the number the handoff actually asks for - the ' +
        'BLOCKED-WANT rate at 2 players. A high full-board rate with a low blocked-want rate is ' +
        'boards filling up harmlessly; the two together are the case for Dean’s island ' +
        'alternative (X2), which is to be reported and NOT built.',
      `mean full-board turn boundaries per GAME, all seats pooled: ${num(
        pooled.ended.length === 0
          ? NaN
          : pooled.ended.reduce(
              (a, g) => a + g.doorClogTurnsBySeat.slice(0, g.seats).reduce((x, y) => x + y, 0),
              0,
            ) / pooled.ended.length,
        2,
      )}`,
    ],
    verdict: 'OBSERVE',
  };
}
