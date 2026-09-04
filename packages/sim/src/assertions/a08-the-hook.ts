import { isMeepleCurrency } from '@gp/data';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns, visitsPerTurnBySuit } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * Watch-list 8: the cross-farm circuit versus solitaire test, made numeric.
 * The assertion that matters most, and the one with no remedy - because this
 * one IS the design. A failure here is not a knob to turn.
 *
 * ⭐⭐ THE ONE THING THIS ASSERTION MUST GET RIGHT IN v31, AND THE REASON IT
 * WAS REWRITTEN ON 02/09/2026: **A SELF-VISIT IS NOT INTERACTION.**
 *
 * v31 lets a seat place its bonus card on its OWN Notice Board and take its own
 * suit's action. That is a solitaire door bought with the interaction door's
 * own currency, sitting in the same slot, and every previous version of this
 * game has had the solitaire option crowd the visit out when the two competed
 * for one slot. The plan (risk 2) states the failure mode in as many words: an
 * assertion that pools the two "will report a healthy hook while the table
 * plays solitaire". So the value this assertion returns, and the number its
 * threshold is read against, is NEIGHBOUR visits per turn and nothing else. The
 * self-visit share is printed beside it as the counterweight, never added to
 * it.
 *
 * ⭐⭐ AND THE SELF-VISIT COUNTER SURVIVES THE MEEPLE-LOOP ARM AS AN INVARIANT
 * RATHER THAN AS A SHARE (04/09/2026, handoff section 4). X5 rules out the
 * self-visit under any flag: `enumerateMeepleVisits` never enumerates the seat's
 * own board and `doMeepleVisit` throws if one reaches it, so the honest number
 * under the arm is a structural ZERO. **It is asserted, not assumed.** A
 * non-zero reading is not a design finding and not a hook that has gone
 * solitaire - it is an engine bug, and one that would silently inflate the very
 * number this assertion exists to protect, so it FAILS the assertion outright
 * and says so. Deleting the counter because "it cannot happen" would remove the
 * only thing that would notice if it did.
 *
 * The threshold comes straight out of the clock the design describes: base
 * Draw nets spare cards, and a spare card funds one visit a turn. Half of the
 * design's own intended rate is the floor; below it the spare card is going
 * somewhere other than a neighbour's farm.
 *
 * ⚠️ THE FLOOR IS CARRIED FROM v14 AND THE CLOCK UNDER IT HAS LOOSENED. Draw is
 * now 2-keep-2 and the bonus slot offers a free Draw 1, so cards are more
 * plentiful than they were when 0.5 was set, and a fixed floor gets EASIER to
 * clear as the card supply loosens. Read a bare pass here with that in mind:
 * the number to watch is the neighbour share against the self share, which is
 * scale-free, rather than the absolute rate against a floor set under a
 * tighter clock.
 *
 * ⚠️ AND UNDER THE ARM THE FLOOR IS UNCHANGED BUT THE THING UNDER IT IS NOT.
 * The handoff keeps 0.5 explicitly, and it is the same sentence about the same
 * event - a visit to a neighbour, per player per turn - so the two arms' hook
 * numbers ARE comparable, which is the whole reason the arm was built as a
 * knob. What is not comparable is the CLOCK the floor was derived from: the
 * spare card that was supposed to fund a visit no longer buys one, because a
 * visit is paid in meeples (R1). The floor now stands on the meeple supply
 * instead, which is five at setup (R3) and recirculates. Nobody has re-derived
 * 0.5 against that supply, and it is deliberately NOT re-derived here: a
 * threshold set from this run's own output would be a snapshot test. Read a
 * pass or a fail beside assertion 15's spends per meeple-turn, which is the
 * number that says whether the supply could have funded more.
 *
 * Ticket 10's control applies here and must be read as intended: a HERMIT
 * MIRROR SHOULD FAIL THIS. Four bots with prohibitive visit weight visit nobody
 * and the run correctly reports solitaire. That is the proof the assertion has
 * teeth, not a bug to chase - which is why this one reports the mirror spread.
 */
export const theHook: Assertion = {
  id: 8,
  title: 'The hook',
  quote:
    "You can't run your farm alone - your neighbours power your engine, so the whole island " +
    'competes to be the farm everyone needs. [02/09/2026, risk 2] Self-visiting is a SOLITAIRE ' +
    'door bought with the same currency as the interaction door. a08-the-hook must count ' +
    'self-visits separately, or the assertion will report a healthy hook while the table plays ' +
    'solitaire. [04/09/2026, the meeple loop] Neighbour visits per player per turn, floor 0.5 ' +
    'unchanged. Keep the self-visit counter and assert it is 0 by construction.',
  source:
    'CLAUDE.md (the hook, and the clock); docs/design-changes-v31-2026-09-02-v1.md part 4, ' +
    'risk 2; docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5',
  shape:
    'NEIGHBOUR visits per player per turn - self-visits excluded from the value and printed ' +
    'beside it; share of turns using the bonus slot; own-crop against foreign-crop builds.',
  threshold:
    "FAIL if NEIGHBOUR visits per turn fall below 0.5 - half the design's own stated rate of " +
    'one. A self-visit never counts toward it. Under visitCurrency "meeple" the assertion ALSO ' +
    'fails on any self-visit at all, because X5 rules the self-visit out under every flag and a ' +
    'non-zero count is an engine bug rather than a design reading.',
  taste: true,
  remedy:
    `${NO_REMEDY} - this one is the design. Under visitCurrency "card" the nearest thing to a ` +
    'lever is rules.turn.selfVisitAllowed: setting it false restores the v30 rule that a visit ' +
    "is always somebody else's board, and it is the paired control for risk 2 rather than a " +
    'fix. Under "meeple" there is no such lever and none is wanted: the whole arm IS the ' +
    'attempted fix, so a failure here is a verdict on the arm, and the things that move it are ' +
    'the two economy knobs (rules.turn.startingMeeplesPerColour, rules.turn.meepleCapPerColour) ' +
    "and Dean's unbuilt island alternative for a blocked meeple (X2).",
  measure({ data, pooled }) {
    const games = pooled.ended;
    const arm = isMeepleCurrency(data);
    const turns = totalTurns(games);
    const all = sum(games.map((g) => sum(g.visitsBySeat)));
    const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
    const neighbours = all - selves;
    const bonus = totalBonusTurns(games);
    const own = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
    const foreign = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
    const value = turns === 0 ? NaN : neighbours / turns;
    const wild = sum(games.map((g) => sum(g.wildVisitsBySeat)));

    // The self-visit line reads as a share under the control and as an
    // INVARIANT under the arm, because that is what it is in each. Same
    // counter, same event flag, two different questions of it.
    const selfLine = arm
      ? `⭐ SELF-VISITS, ASSERTED AT ZERO BY CONSTRUCTION: ${selves}. X5 rules the self-visit ` +
        'out under every flag - the enumerator never offers your own board and the applier ' +
        'throws if one reaches it - so anything but 0 here is an ENGINE BUG, not a solitaire ' +
        'table, and it fails this assertion on its own. The counter is kept precisely because ' +
        '"it cannot happen" is the reason nobody would notice if it did.'
      : `⭐ SELF-VISITS, COUNTED APART AND NEVER CREDITED: ${selves} of ${all} visits ` +
        `(${pct(all === 0 ? NaN : selves / all)} of all visits, ` +
        `${num(turns === 0 ? NaN : selves / turns, 2)} per turn). A self-visit is a ` +
        'solitaire door bought with the interaction door’s currency. If this share ' +
        'climbs while the neighbour line falls, risk 2 has landed and the fix named in the ' +
        'design is rules.turn.selfVisitAllowed false or a sharper clog brake.';

    // ⭐ RIVAL VISITS PER GAME, BESIDE THE PER-TURN RATE (ledger C52). The v1
    // measurement found the two disagree and disagree in opposite directions:
    // per turn the hook fell (0.41 to 0.37) while per game it rose 21% (28.7
    // to 34.8), because the game also grew 35-43% longer over the same change.
    // Nobody has ruled whether the hook is a per-turn or a per-game quantity,
    // and the choice matters beyond bookkeeping: a longer game inflates the
    // per-game number for free, so a per-game reading cannot be trusted on its
    // own without game length beside it. Printed here rather than substituted
    // for the per-turn value: the verdict above is unchanged and stays
    // per-turn, this is additional evidence for the ruling neither number can
    // make on its own.
    const perGame = games.length === 0 ? NaN : neighbours / games.length;
    const meanRounds =
      games.length === 0 ? NaN : games.reduce((a, g) => a + g.rounds, 0) / games.length;

    const detail = [
      selfLine,
      `⭐ RIVAL VISITS PER GAME (ledger C52, read beside the per-turn rate above): ` +
        `${num(perGame, 2)} over a mean ${num(meanRounds, 1)} rounds (${neighbours} visits ` +
        `over ${games.length} games). The two readings are NOT required to agree - a longer ` +
        'game can raise this number while the per-turn rate falls, which is exactly what the ' +
        'v1 measurement found (0.41 to 0.37 per turn, but 28.7 to 34.8 per game, a 21% rise, ' +
        'over a game that also grew 35-43% longer). Neither reading settles which quantity the ' +
        'design is FOR; both are printed so a future ruling has both in front of it.',
      `bonus slot used on ${pct(turns === 0 ? NaN : bonus / turns)} of turns`,
      // Per suit, because the table average cannot answer a per-suit question
      // and every suit change asks one: does this engine pull its player away
      // from their neighbours? Reported, not judged - the threshold above is
      // the table's, and a suit below it is a thing to look at, not a failure.
      `NEIGHBOUR visits per turn by suit: ${[...visitsPerTurnBySuit(games)]
        .sort((a, b) => b[1] - a[1])
        .map(([suit, rate]) => `${suit} ${num(rate, 2)}`)
        .join('  ')}`,
      `builds: ${pct(own + foreign === 0 ? NaN : own / (own + foreign))} own crop, ` +
        `${pct(own + foreign === 0 ? NaN : foreign / (own + foreign))} foreign crop ` +
        `(${own + foreign} builds). ⚠️ RISK 3, the monoculture pull: the Farmstead pays 1 VP ` +
        'per own-suit card built and every Power and Endgame card costs 2 cards of its own ' +
        'suit, so both push this the same way. It was 82.6% before v31 and can only go up; ' +
        'neither pull is a knob, so undoing either is a card change.',
    ];
    if (arm) {
      detail.splice(
        2,
        0,
        `${wild} of those visits were paid with a WILD PAIR of meeples ` +
          `(${pct(neighbours === 0 ? NaN : wild / neighbours)}). A wild visit is a full visit ` +
          'and is credited as one here: it costs the visitor two stored actions instead of one ' +
          'and buys the same door. Whether the table needs it that often is assertion 7’s ' +
          'question, not this one’s.',
        '⚠️ THE FLOOR OF 0.5 IS CARRIED UNCHANGED AND ITS CLOCK IS NOT. It was derived from a ' +
          'spare card funding one visit a turn, and a visit no longer costs a card (R1). It now ' +
          'stands on the meeple supply - five at setup (R3), recirculating - and nobody has ' +
          're-derived it against that. It is deliberately not re-derived from this run: a ' +
          'threshold taken from our own output is a snapshot test that can never fail. Read it ' +
          'beside assertion 15’s spends per meeple-turn.',
      );
    }

    const bug = arm && selves > 0;
    return {
      value,
      headline:
        `${num(value, 2)} NEIGHBOUR visits per player per turn ` +
        `(${neighbours} of ${all} visits over ${turns} turns)` +
        (bug ? ` ⛔ AND ${selves} SELF-VISITS UNDER AN ARM THAT FORBIDS THEM (X5)` : ''),
      detail,
      verdict: bug ? 'FAIL' : !Number.isFinite(value) ? 'OBSERVE' : value < 0.5 ? 'FAIL' : 'PASS',
    };
  },
};
