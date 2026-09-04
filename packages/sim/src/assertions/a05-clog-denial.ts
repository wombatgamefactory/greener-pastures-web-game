import { isMeepleCurrency } from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { num, pct } from '../stats.js';

/**
 * Watch-list 5. The Notice Board is the only visit target in the game, so a
 * full board blocks the whole of a farm's cross-table surface at once, and a
 * leader can sit on it.
 *
 * Sampled at the seat's BONUS WINDOW, holding something to visit with. Both
 * conditions matter: once the bonus slot is spent there are no visits for a
 * reason that is not denial, and a seat with nothing to pay the visit with has
 * a supply problem rather than a clog.
 *
 * ⚠️ "SOMETHING TO VISIT WITH" IS A DIFFERENT RESOURCE IN EACH ARM, and the
 * probe branches on the knob rather than carrying one test across both. Under
 * `visitCurrency: 'card'` it is a card in hand; under `'meeple'` a visit costs
 * no card at all (R1) and the hand is irrelevant, so the exclusion is an empty
 * SUPPLY. Carrying the hand test into the arm would have defined the sampled
 * population by the wrong resource, which is the same species of mistake as
 * copying a predicate out of the rules - see below.
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
 * The 15%-at-2p threshold survives under the card game because the design's
 * sentence does: what it is measuring is still "I am holding cards and cannot
 * interact". The self-visit is included in "legal anywhere" deliberately - a
 * seat that can still feed its own board has an option, even a solitaire one.
 *
 * The design floats a dial - the Notice Board threshold to 4 at two seats - but
 * has never adopted it, so it is noted in rules.json's `unresolved` and is NOT
 * prescribed here. Ticket 11's rule: never an invented remedy.
 *
 * ## ⭐⭐ THE ARM RE-CUTS THIS ONTO THE BLOCKED-WANT RATE (04/09/2026)
 *
 * The handoff names the number it wants and it is not "no visit is legal
 * anywhere": it is **turns on which a seat held a usable colour and no free slot
 * for it existed anywhere on the table**. The two questions come apart under the
 * arm, and the difference is the whole of the arm's availability claim:
 *
 *   SHUT OUT       no visit legal at all - the old question, still counted and
 *                  printed, because it is the harshest case
 *   BLOCKED WANT   the meeple you wanted to spend had nowhere to go, whether or
 *                  not some OTHER colour did
 *
 * Under v31 a rival board offered ONE action, its owner's suit, so "shut out"
 * and "blocked" were nearly the same event. Under the arm every board offers all
 * five colours minus the ones already blocked, so a seat is very rarely shut out
 * and can still be blocked on the colour it actually holds. Reporting only the
 * shut-out rate would therefore show the arm passing handsomely while the thing
 * Dean asked to be measured went unmeasured.
 *
 * ⭐ "ANYWHERE ON THE TABLE" MEANS ON A RIVAL'S BOARD. X5 rules the self-visit
 * out under every flag, so a free slot on your own board is not somewhere a
 * meeple can be spent. At 2 players that leaves exactly one board, which is why
 * the handoff asks for this number at 2p first and why 2p leads the row here.
 *
 * ⭐ AND "USABLE" IS A REAL GATE, not a formality. A colour whose door can do
 * nothing for you right now (`workerActionLegal` false) is not blocked, it is
 * simply not wanted this turn, and counting it would blame the slots for what is
 * a card-supply problem. Dean's standing ruling that a door which can do nothing
 * is not offered survives the currency change and is what makes the distinction
 * measurable at all.
 *
 * ⛔ **THE 15% THRESHOLD DOES NOT CARRY ACROSS AND IS NOT REPLACED.** It was set
 * against a question about card-fee visits into single-action boards, and the
 * handoff names no number for the blocked-want rate - it asks for it to be
 * REPORTED, because what it decides is whether Dean's island alternative (X2)
 * has to come back, and that is his call and not a threshold. So the arm ships
 * as OBSERVE. **Report it; do not build the alternative.**
 */
const TWO_SEAT_DENIAL = 0.15;

export const clogDenial: Assertion = {
  id: 5,
  title: 'Clog as denial',
  quote:
    'A full Notice Board blocks visits, and it is the only visit target in the game. Mostly ' +
    'self-correcting. But a leader CAN sit on a full board to lock rivals out of the action ' +
    'they need. Watch at 2p specifically. [02/09/2026] A clogged Notice Board at 2 players is ' +
    'total denial rather than a race. [04/09/2026, the meeple loop] The blocked-want rate and ' +
    'the hold-out rate at 2 players decide whether the island alternative comes back. Report ' +
    'it; do not build the alternative.',
  source:
    'docs/Unified Visit v14.md section 7.4; rules.json meta.unresolved, on the 2-seat game; ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4, 5 and X2',
  shape:
    'Under visitCurrency "card": share of turns begun holding cards on which no visit is legal ' +
    'anywhere, by seat count. Under "meeple": share of bonus windows reached holding a meeple ' +
    'on which a USABLE colour had no free slot on any rival board, by seat count with 2p first, ' +
    'printed beside the shut-out rate and the hold-out rate.',
  threshold:
    `Under "card": FAIL above ${pct(TWO_SEAT_DENIAL, 0)} at 2 seats. Under "meeple": OBSERVE. ` +
    'The 15% was set against card-fee visits into boards that offered one action each; a ' +
    'meeple board offers five colours, so the population and the event are both different and ' +
    'the number would not mean the same thing. The handoff asks for the blocked-want rate to be ' +
    "REPORTED rather than judged, because what it decides - whether Dean's island alternative " +
    'for a blocked meeple comes back - is his ruling and not a threshold.',
  taste: false,
  remedy:
    `${NO_REMEDY}. Under "card" the threshold-4-at-2p dial is recorded as unadopted in ` +
    'rules.json and is deliberately not offered as a fix. Read it beside assertion 4 first: a ' +
    'high reading there with a low clog rate is not denial at all, it is doors with nothing ' +
    'legal to do. Under "meeple" there is no lever and none may be invented: X2 keeps the ' +
    'island alternative UNBUILT until Dean rules, X4 refuses two slots per colour at 2 players, ' +
    'and X1 and X3 refuse the automatic clear and the host penalty. The two knobs that touch ' +
    'the supply rather than the slots are rules.turn.meepleCapPerColour ' +
    '(overlays/meeple-loop-cap-two-v1.overlay.json) and rules.turn.startingMeeplesPerColour ' +
    '(overlays/meeple-loop-no-starting-meeples-v1.overlay.json).',
  measure(ctx) {
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/** The shipped v31 game, unchanged since 02/09/2026. */
function cardGame({ pooled }: MeasureContext): Measurement {
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
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value > TWO_SEAT_DENIAL ? 'FAIL' : 'PASS',
  };
}

/** The meeple-loop arm: the blocked-want rate, 2p first, with the hold-out rate beside it. */
function meepleArm({ pooled }: MeasureContext): Measurement {
  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      let blocked = 0;
      let blockedSampled = 0;
      let shutOut = 0;
      let shutSampled = 0;
      let held = 0;
      let heldSampled = 0;
      for (const g of slice.ended) {
        for (let seat = 0; seat < g.seats; seat++) {
          blocked += g.blockedWantTurnsBySeat[seat] ?? 0;
          blockedSampled += g.blockedWantSampledBySeat[seat] ?? 0;
          shutOut += g.clogTurnsBySeat[seat] ?? 0;
          shutSampled += g.clogSampledBySeat[seat] ?? 0;
          held += g.holdOutTurnsBySeat[seat] ?? 0;
          heldSampled += g.holdOutSampledBySeat[seat] ?? 0;
        }
      }
      return {
        seats: slice.seats,
        blocked: blockedSampled === 0 ? NaN : blocked / blockedSampled,
        blockedSampled,
        shutOut: shutSampled === 0 ? NaN : shutOut / shutSampled,
        shutSampled,
        heldOut: heldSampled === 0 ? NaN : held / heldSampled,
        heldSampled,
      };
    });

  const twoSeat = rows.find((r) => r.seats === 2);
  const value = twoSeat?.blocked ?? NaN;

  return {
    value,
    headline:
      `BLOCKED WANT ${rows.map((r) => `${r.seats}p ${pct(r.blocked)}`).join('  ')} of bonus ` +
      'windows reached holding a meeple: a usable colour with no free slot on any rival board',
    detail: [
      `HOLD-OUT rate, boards still full at their owner’s turn start: ${rows
        .map((r) => `${r.seats}p ${pct(r.heldOut)}`)
        .join('  ')}`,
      `SHUT OUT entirely, no visit legal anywhere: ${rows
        .map((r) => `${r.seats}p ${pct(r.shutOut)}`)
        .join('  ')}`,
      ...rows.map(
        (r) =>
          `${r.seats}p: ${r.blockedSampled} bonus windows sampled holding a meeple, ` +
          `${r.heldSampled} turn starts sampled for the hold-out`,
      ),
      '⭐ BLOCKED-WANT AND SHUT-OUT ARE NOT THE SAME QUESTION AND THE GAP BETWEEN THEM IS THE ' +
        'ARM’S OWN CLAIM. Under v31 a rival board offered one action, its owner’s suit, so ' +
        'being blocked and being shut out were nearly the same event. Here every board offers ' +
        'five colours minus the blocked ones, so a seat is rarely shut out and can still be ' +
        'blocked on the colour it holds. A low shut-out rate is not evidence that the slots are ' +
        'free.',
      '⭐ "ANYWHERE" MEANS ON A RIVAL’S BOARD, because X5 rules the self-visit out under every ' +
        'flag. At 2 players that is one board, which is why 2p leads the row and why this is ' +
        'the number that decides whether Dean’s island alternative (X2) comes back. REPORT IT; ' +
        'DO NOT BUILD THE ALTERNATIVE.',
      '⚠️ "USABLE" IS A REAL GATE. A colour whose door can do nothing for you right now is not ' +
        'counted as blocked - it was not wanted - so this line cannot be inflated by a seat ' +
        'holding a Deliver meeple with an empty barn. That is the standing ruling that a door ' +
        'which can do nothing is not offered, doing measurement work.',
      '⚠️ THE HOLD-OUT RATE IS NOT A SHARE OF ANYTHING THE BOTS WERE PRICED TO WANT. Collect ' +
        'is priced as a draw plus the meeples actually kept after the cap, so a bot holds out ' +
        'only when its board holds duplicates it cannot use; a human might hold out to deny ' +
        'five colours at once. Read a low reading as "the pricer never wanted to", never as ' +
        '"nobody would". X3 rules out any penalty for holding out, so the behaviour is legal, ' +
        'deliberate and unpriced.',
      `mean blocked-want turns per GAME, all seats pooled: ${num(
        pooled.ended.length === 0
          ? NaN
          : pooled.ended.reduce(
              (a, g) => a + g.blockedWantTurnsBySeat.slice(0, g.seats).reduce((x, y) => x + y, 0),
              0,
            ) / pooled.ended.length,
        2,
      )}`,
    ],
    verdict: 'OBSERVE',
  };
}
