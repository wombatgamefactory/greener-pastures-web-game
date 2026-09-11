import {
  isCommons,
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardsPerSeat,
  unclaimedBoardsToCentre,
} from '@gp/data';

import type { Assertion, Measurement } from './types.js';
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
 * ## ⛔⛔ AND UNDER THE COMMONS THERE IS NO NEIGHBOUR AT ALL (C1, 09/09/2026)
 *
 * The five Notice Boards stand OWNERLESS in the centre of the table. Nobody has
 * a board, so a play has no host: `visited` never fires, `visitsBySeat` is a
 * structural zero, and "NEIGHBOUR visits per player per turn" is a rate over an
 * event that cannot happen. **This assertion therefore reports NO SUBJECT under
 * the commons and carries no verdict.**
 *
 * ⚠️ **THAT IS A STATEMENT ABOUT THE INSTRUMENT AND NOT ABOUT THE DESIGN, AND
 * THE DIFFERENCE MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS SUITE.** The hook
 * has not been abandoned - the commons is an attempt at the same hook by a
 * different route, a shared pile everybody feeds and everybody may harvest - and
 * a zero on this line is not evidence the table plays solitaire. What it means
 * is that the QUANTITY this assertion was built to count (a visit to a named
 * rival's farm) no longer exists, and a floor of 0.5 read against a structural
 * zero would print a FAIL every run for ever, which measures nothing and would
 * train a reader to ignore the most important line in the report.
 *
 * ⭐ **`a18-commons-traffic` CARRIES THE INTERACTION READINGS INSTEAD**, and it
 * ships as OBSERVE in this pass because the design names no number for any of
 * them: plays per player per turn, central harvests per player per game, the
 * pile depth at harvest, and the share of barn cards sourced from the centre
 * rather than from a seat's own buildings. Read a18 wherever this line would
 * have been read. Neither this assertion nor that one may borrow the other's
 * threshold: 0.5 was derived from a spare card funding one visit a turn, and
 * there is nothing in the commons for it to be a floor ON.
 *
 * ## ⭐⭐ AND ON 10/09/2026 THE HOOK GOT ITS SUBJECT BACK (S2, S5, S7)
 *
 * The notice-board visit deletes the centre and sends the five Notice Board
 * cards home to their owners' farms as BUILDINGS again. There is a HOST once
 * more: the bonus is to play one card from your hand onto ANY player's Notice
 * Board and take that board's printed power, and the card rests on the host's
 * board until the host harvests it into their barn, which is the host's whole
 * payment and there is no other. `visited` fires again, `visitsBySeat` and
 * `visitsReceivedBySeat` are real counts again, and "NEIGHBOUR visits per
 * player per turn" is a rate over an event that happens.
 *
 * ⛔ **SO THIS ASSERTION IS RESTORED FOR THAT MODE, AND IT IS RESTORED
 * EXPLICITLY RATHER THAN BY FALLING THROUGH.** Before 10/09/2026 the only
 * guard here was `isCommons`, so a fourth currency would have landed on the
 * `cardGame` path by accident and read correctly by luck. Reading correctly by
 * luck is the state this project has twice paid for: a branch nobody chose is a
 * branch nobody checked. `isNoticeBoardPower` is now asked by name, the
 * restoration is printed in the report so a reader is told rather than left to
 * notice a line that used to say NO SUBJECT, and the mode's own sentences ride
 * with it.
 *
 * ⚠️ **THE FLOOR OF 0.5 IS CARRIED UNCHANGED AND ITS CLOCK IS NOT.** It was
 * derived from a spare card funding one visit a turn, which is EXACTLY the
 * clock this mode runs on - a visit costs one card from hand - so the derivation
 * fits this arm better than it has fitted anything since v14. What has moved
 * under it is that the bonus slot now holds ONE option (the standalone free
 * Draw 1 is shut off under this currency) and A Helping Hand can buy a second
 * visit, so the rate has more room above it than it did. It is deliberately NOT
 * re-derived from this run's output: a threshold taken from our own first run
 * is a snapshot test that can never fail.
 *
 * ⛔ **AND THE SELF-VISIT IS RULED IN HERE, WHICH IS NOT WHAT IT WAS IN v31.**
 * S6 reverses the ban of 04/09/2026 deliberately, because the five boards print
 * five DIFFERENT powers: your own board is one option of five and it is the one
 * that never has what you have not got, where in v31 every board printed the
 * same thing and a self-visit was strictly better than a visit. **The counter
 * is unchanged and the value still credits NEIGHBOUR visits alone** - a
 * self-visit remains a solitaire door bought with the interaction door's
 * currency, whether or not the design wants it - and the self share is the
 * headline risk of the pass rather than a bug. a17 splits it by seat count.
 *
 * ⛔ **DO NOT DELETE THIS ASSERTION OR ITS COUNTERS.** Both controls still
 * exercise every branch above - `overlays/v31-card-visit.overlay.json` runs the
 * card game and `overlays/meeple-loop-v1.overlay.json` the meeple loop - and
 * the self-visit invariant under the meeple arm is the only thing in the project
 * that would notice X5 breaking.
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
    'unchanged. Keep the self-visit counter and assert it is 0 by construction. [09/09/2026, ' +
    'the commons] a08-the-hook: no neighbour exists. Under commons it reports "no subject" and ' +
    'a new a18-commons-traffic carries the interaction readings. [10/09/2026, the notice-board ' +
    'visit] a08 THE HOOK HAS A SUBJECT AGAIN. It has printed NO SUBJECT since 09/09/2026. ' +
    'Restore it and say in the report that it is back.',
  source:
    'CLAUDE.md (the hook, and the clock); docs/design-changes-v31-2026-09-02-v1.md part 4, ' +
    'risk 2; docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5; ' +
    'docs/commons-handoff-2026-09-09-v1.md section 2.7; ' +
    'docs/notice-board-visit-handoff-2026-09-10-v2.md section 3.4 (a08 restored) and S2, S5, ' +
    'S6 and S7 of section 2',
  shape:
    'NEIGHBOUR visits per player per turn - self-visits excluded from the value and printed ' +
    'beside it; share of turns using the bonus slot; own-crop against foreign-crop builds. ' +
    'Under "commons": nothing. The boards are ownerless, so there is no neighbour to visit ' +
    'and a18 owns the interaction readings. ⭐ Under "noticeBoardPower" (10/09/2026) the same ' +
    'shape as under "card" and RESTORED BY NAME rather than by falling through: the boards are ' +
    'owned again, a visit is one card from hand onto ANY player’s board for that board’s ' +
    'printed power, and the card rests there as the host’s whole payment. The self-visit is ' +
    'RULED IN under that mode (S6) and is still counted apart and never credited. ' +
    '⭐ AND SINCE 11/09/2026, UNDER rules.economy.unclaimedBoardsToCentre, THE CENTRAL PLAY IS ' +
    'COUNTED AND PRINTED BESIDE THE HOOK AND IS NEVER CREDITED TO IT: an ownerless pile has no ' +
    'host, so a play onto one is not a visit to a neighbour, and the line says how many there ' +
    'were so a reader cannot mistake traffic that MOVED for traffic that STOPPED.',
  threshold:
    "FAIL if NEIGHBOUR visits per turn fall below 0.5 - half the design's own stated rate of " +
    'one. A self-visit never counts toward it. Under visitCurrency "meeple" the assertion ALSO ' +
    'fails on any self-visit at all, because X5 rules the self-visit out under every flag and a ' +
    'non-zero count is an engine bug rather than a design reading. Under "commons" there is NO ' +
    'SUBJECT and no verdict: the five boards are ownerless (C1), so a play has no host, a ' +
    'visit to a neighbour cannot happen, and a floor read against a structural zero would FAIL ' +
    'every run for ever. a18-commons-traffic carries the interaction readings instead. ' +
    '⭐ Under "noticeBoardPower" the floor of 0.5 is LIVE AGAIN and carried unchanged: the ' +
    'clock it was derived from - a spare card funding one visit a turn - is exactly this ' +
    'mode’s clock, because a visit costs one card from hand. A self-visit never counts ' +
    'toward it there either, even though S6 rules self-visiting IN. ' +
    '⛔ AND A CENTRAL PLAY NEVER COUNTS TOWARD IT UNDER ' +
    'rules.economy.unclaimedBoardsToCentre (ruled 11/09/2026). A central board is ownerless, ' +
    'so the play has no host and pays nobody; crediting it would let this design PASS the hook ' +
    'while nobody at the table ever visited a person, which is exactly the failure the variant ' +
    'is being tested for. The count is printed beside the value instead, so a low value can be ' +
    'told from a slot nobody spends.',
  taste: true,
  remedy:
    `${NO_REMEDY} - this one is the design. Under visitCurrency "card" the nearest thing to a ` +
    'lever is rules.turn.selfVisitAllowed: setting it false restores the v30 rule that a visit ' +
    "is always somebody else's board, and it is the paired control for risk 2 rather than a " +
    'fix. Under "meeple" there is no such lever and none is wanted: the whole arm IS the ' +
    'attempted fix, so a failure here is a verdict on the arm, and the things that move it are ' +
    'the two economy knobs (rules.turn.startingMeeplesPerColour, rules.turn.meepleCapPerColour) ' +
    "and Dean's unbuilt island alternative for a blocked meeple (X2). Under " +
    '"noticeBoardPower" the lever is the one it was under "card" and it is a real control this ' +
    'time: overlays/notice-board-visit-no-self-v1.overlay.json sets rules.turn.selfVisitAllowed ' +
    'false, and the handoff calls it the single most important sub-arm in the plan. It is the ' +
    'paired control for the headline risk rather than a fix, because S6 rules self-visiting IN.',
  measure({ data, pooled }) {
    const games = pooled.ended;
    if (isCommons(data)) return noSubject(pooled.ended.length);
    // ⭐ ASKED BY NAME, AND THAT IS THE POINT OF THE LINE. Before 10/09/2026
    // the only guard here was `isCommons`, so the notice-board visit would have
    // landed on the `cardGame` path by falling through and read correctly by
    // luck. The counters ARE the right ones - `visited` fires, the host is a
    // real seat, the fee is a card - so the arithmetic below is unchanged; what
    // this flag buys is that the restoration is a decision somebody made and
    // that the report can SAY the hook is back rather than leaving a reader to
    // notice a line that stopped saying NO SUBJECT.
    const restored = isNoticeBoardPower(data);
    const arm = isMeepleCurrency(data);
    const turns = totalTurns(games);
    const all = sum(games.map((g) => sum(g.visitsBySeat)));
    const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
    const neighbours = all - selves;
    // ⭐ THE CENTRAL PLAY, COUNTED HERE AND DELIBERATELY NEVER CREDITED
    // (11/09/2026). Dean's unclaimed-boards variant puts ownerless piles on the
    // table beside the owned boards, and both are bought out of the same bonus
    // slot - so this assertion has a second population in front of it for the
    // first time and has to say what it does with it. It does nothing with it,
    // and the reason is the assertion's own definition: the hook counts
    // NEIGHBOUR visits, a central play has NO HOST, and crediting one would let
    // the design pass the hook while nobody ever visits a person. That is
    // precisely the failure mode the variant was built to be tested for.
    const centre = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
    const withCentre = restored && unclaimedBoardsToCentre(data);
    const bonus = totalBonusTurns(games);
    const own = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
    const foreign = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
    const value = turns === 0 ? NaN : neighbours / turns;
    const wild = sum(games.map((g) => sum(g.wildVisitsBySeat)));

    // ⭐⭐ THE CROSS-TABLE SHARE, BY SEAT COUNT, AND IT IS THIS ARM'S WHOLE
    // CLAIM ARRIVING AS A NUMBER (Dean's two-board fix, 11/09/2026). Of
    // everything the bonus slot bought, what share of it reached a PERSON?
    // The unclaimed-boards variant fixed the two-seat starve by adding targets
    // that were NOT people and read 14.7% here at two seats; this arm fixes the
    // same starve by adding targets that ARE people, so the share should be
    // 100% AT EVERY SEAT COUNT and anything less is a leak rather than a taste.
    const twoBoards = restored && [1, 2, 3, 4].some((n) => noticeBoardsPerSeat(data, n) > 1);
    const crossRows = [...pooled.bySeats]
      .sort((a, b) => a.seats - b.seats)
      .map((slice) => {
        const v = sum(slice.ended.map((g) => sum(g.visitsBySeat)));
        const s = sum(slice.ended.map((g) => sum(g.selfVisitsBySeat)));
        const c = sum(slice.ended.map((g) => sum(g.commonsPlaysBySeat)));
        const t = totalTurns(slice.ended);
        return {
          seats: slice.seats,
          share: v + c === 0 ? NaN : (v - s) / (v + c),
          plays: v + c,
          hook: t === 0 ? NaN : (v - s) / t,
        };
      });
    const crossTable = all + centre === 0 ? NaN : neighbours / (all + centre);
    // ⛔ THE INVARIANT, AND IT IS A FAIL AND NOT AN OBSERVATION. With
    // self-visiting banned and no centre on the table, every target the slot can
    // buy is a rival's board, so every play crosses the table by construction. A
    // self-visit or a central play under those knobs is an ENGINE BUG - a ban
    // that leaked or a centre that was not turned off - and it would inflate the
    // one reading this arm exists to protect. It is asserted rather than
    // assumed, on exactly the contract the meeple arm's X5 zero is asserted on.
    const everyTargetIsAPerson = restored && !data.rules.turn.selfVisitAllowed && !withCentre;
    const leak = everyTargetIsAPerson && (selves > 0 || centre > 0);

    // The self-visit line reads as a share under the control and as an
    // INVARIANT under the arm, because that is what it is in each. Same
    // counter, same event flag, two different questions of it.
    const selfLine = restored
      ? !data.rules.turn.selfVisitAllowed
        ? `⛔ SELF-VISITS ARE BANNED ON THIS RUN AND READ ${selves}, WHICH IS THE BAN WORKING ` +
          'RATHER THAN A PREFERENCE (rules.turn.selfVisitAllowed false). The enumerator never ' +
          'offers your own board, so anything but 0 here is a bug in the ban and not a ' +
          'finding. ⭐ THE BAN IS HALF OF DEAN\u2019S VARIANT OF 11/09/2026 AND THE CENTRE IS ' +
          'THE OTHER HALF: the ban on its own starved two players to 29.1% of turns, because a ' +
          'seat with only two suits in play then had exactly ONE board it could visit, and the ' +
          'unclaimed boards are what feed the target set back to four at every seat count. ' +
          '⚠️ SO THE TWO KNOBS MUST BE READ AS A 2x2 AND NEVER AS ONE CHANGE: ' +
          'overlays/notice-board-visit-no-self-v1.overlay.json is this ban with no centre, and ' +
          'overlays/notice-board-visit-unclaimed-self-v1.overlay.json is the centre with no ban.'
        : `⚠️ SELF-VISITS, RULED IN AND STILL NEVER CREDITED: ${selves} of ${all} visits ` +
          `(${pct(all === 0 ? NaN : selves / all)} of all visits, ` +
          `${num(turns === 0 ? NaN : selves / turns, 2)} per turn). S6 REVERSES the ban of ` +
          '04/09/2026 on purpose, and the argument is variety: the five boards print five ' +
          'DIFFERENT powers, so your own board is one option of five and it is the one that ' +
          'never has what you have not got, where in v31 every board printed the SAME thing and ' +
          'a self-visit was strictly better than a visit. ⛔ THE RULING DOES NOT CHANGE THE ' +
          'ARITHMETIC: a self-visit is still a solitaire door bought with the interaction ' +
          "door's currency, so it is still counted apart and still never added to the value " +
          'above. ⛔ AND THE SHARE IS THE HEADLINE RISK OF THE WHOLE PASS: v31 read 22.2% with ' +
          'identical boards, and much above that here says the variety argument is wrong and the ' +
          'interaction is decoration. a17 splits it by seat count and it should be worst at two ' +
          "players, where a neighbour's gift is closest to zero-sum; the control is " +
          'overlays/notice-board-visit-no-self-v1.overlay.json.'
      : arm
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

    // ⭐ THE RESTORATION LINE, PRINTED FIRST AND ONLY UNDER THE MODE THAT
    // EARNED IT. The handoff asks for this in as many words - "restore it and
    // say in the report that it is back" - because a reader who last saw this
    // assertion print NO SUBJECT will otherwise read a bare 0.41 as a number
    // that was always there. A permanent banner is a banner nobody reads, so it
    // fires under `noticeBoardPower` and under nothing else.
    const restoredLine =
      '⭐⭐ THE HOOK HAS A SUBJECT AGAIN (S2, S5, S7, Dean 10/09/2026), AND THIS LINE HAS ' +
      'PRINTED "NO SUBJECT" SINCE 09/09/2026. ' +
      (withCentre
        ? 'The Notice Board of every suit somebody IS farming has gone home to its owner as a ' +
          'BUILDING (the rest stand ownerless in the middle, and the line above counts those ' +
          'separately), '
        : 'The commons is deleted, the five Notice Board cards have gone home to their owners ' +
          'as BUILDINGS again, ') +
      "and the bonus is to play one card from your hand onto ANY player's board for that " +
      "board's printed power. So there is " +
      'a HOST once more, `visited` fires again, and NEIGHBOUR visits per player per turn is a ' +
      'rate over an event that can happen. ⚠️ THE HOST IS PAID IN MATERIAL AND NOT IN A ' +
      'WAGE: the card rests on their board until they harvest it into their barn, and that is ' +
      'their whole payment (S7). a18 measures what share of barn cards arrive that way and ' +
      'a20 measures whether the boards are ever cleared at all. ⛔ NO NUMBER ON THIS LINE IS ' +
      'COMPARABLE WITH A v31 ONE AS A LEVEL: the boards print five different POWERS here ' +
      'rather than five identical doors, the standalone free Draw 1 is shut, and A Helping ' +
      'Hand can buy a second visit. A delta paired on identical seeds is sound; a level quoted ' +
      'across the two designs is not.';

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

    // ⛔ THE LINE THAT STOPS A READER CONCLUDING THE TRAFFIC VANISHED. Without
    // it a hook value that fell when the centre opened is indistinguishable
    // from a table that stopped using the bonus slot at all, and the two have
    // opposite remedies. Printed only where there IS a centre, because a
    // permanent banner is a banner nobody reads.
    const centreLine =
      `⛔ CENTRAL PLAYS EXIST UNDER THIS ARM AND NONE OF THEM IS CREDITED ABOVE: ${centre} ` +
      `plays onto an OWNERLESS central pile, ${num(turns === 0 ? NaN : centre / turns, 2)} per ` +
      `player per turn, against ${neighbours} neighbour visits at ${num(value, 2)}. Of the ` +
      `${all + centre} plays the bonus slot bought, ` +
      `${pct(all + centre === 0 ? NaN : neighbours / (all + centre))} CROSSED THE TABLE to a ` +
      'named person. ⭐ THE EXCLUSION IS THE RULING AND NOT AN OVERSIGHT (11/09/2026): a ' +
      'central board belongs to nobody, so a play onto it has no host, pays no host and is not ' +
      'a visit to a neighbour under any reading of the word. ⛔ CREDITING IT WOULD LET THIS ' +
      'DESIGN PASS THE HOOK WHILE NOBODY EVER VISITS A PERSON, which is exactly the failure ' +
      'the variant is being tested for: a central board is socially free and a rival board is ' +
      'not, so the standing incentive is to prefer the centre, strongest at two players where ' +
      'three of the four targets are central. ⚠️ BUT A FALLING VALUE ABOVE IS THEREFORE TWO ' +
      'DIFFERENT FINDINGS AND THIS LINE SEPARATES THEM: traffic that moved to the centre reads ' +
      'as a high number here, and traffic that stopped reads as a low one. a17 carries the OWN ' +
      '/ RIVAL / CENTRAL split by seat count and a18 the visits received per player; read both ' +
      'before acting on the verdict on this page.';

    // ⭐⭐ THE LINE DEAN'S TWO-BOARD FIX IS JUDGED ON, printed under
    // `noticeBoardPower` and under nothing else. Everything else on this page
    // asks how MUCH traffic there was; this asks how much of it reached a
    // PERSON, which is the quantity the last three days of design have been
    // spent on and the one the unclaimed-boards variant destroyed.
    const crossLine =
      `⭐⭐ THE CROSS-TABLE SHARE OF EVERY PLAY THE SLOT BOUGHT: ${pct(crossTable)} of ` +
      `${all + centre} plays reached a NAMED PERSON. By seat count: ${crossRows
        .map((r) => `${r.seats}p ${pct(r.share)} of ${r.plays}`)
        .join('  ')}. ` +
      (everyTargetIsAPerson
        ? '⛔ IT MUST READ 100% AT EVERY SEAT COUNT AND ANYTHING ELSE IS A BUG RATHER THAN A ' +
          'FINDING. Self-visiting is banned (rules.turn.selfVisitAllowed false) and there is no ' +
          'centre (rules.economy.unclaimedBoardsToCentre false), so EVERY TARGET THE BONUS SLOT ' +
          'CAN BUY IS A RIVAL’S BOARD and every play crosses the table by construction. ' +
          `Self-visits read ${selves} and central plays read ${centre}; ` +
          (leak
            ? '⛔⛔ ONE OF THEM IS NON-ZERO, WHICH IS A BAN THAT LEAKED OR A CENTRE THAT WAS ' +
              'NOT TURNED OFF, and it inflates the very reading this arm exists to protect. ' +
              'This assertion FAILS on it.'
            : 'both are zero, which is the two knobs working.')
        : '⚠️ NOT EVERY TARGET IS A PERSON ON THIS RUN, so this share is a real preference ' +
          'reading rather than an invariant: a self-visit or a central play is a play that ' +
          'paid nobody. a17 carries the OWN / RIVAL / CENTRAL split by seat count.') +
      (twoBoards
        ? ' ⭐⭐ AND THIS IS THE WHOLE ARGUMENT FOR DEAN’S TWO-BOARD FIX, MEASURED RATHER THAN ' +
          'ARGUED. The starve at two seats had two proposed cures and they differ in one thing ' +
          'only: WHAT THE EXTRA TARGETS ARE. The unclaimed-boards variant added OWNERLESS ' +
          'central boards, fixed the rate and read 14.7% cross-table at two players - the ' +
          'neighbour designed out for the second time in three days. This arm adds a SECOND ' +
          'BOARD TO A PERSON, so the target count rises to 2 / 2 / 3 by seat count and every ' +
          'one of them is somebody who gets paid. ⛔ THE HEADLINE IS THE HOOK ITSELF AND NOT ' +
          'THIS SHARE: the no-self control is the only corner of the 11/09/2026 2x2 that ' +
          `PASSES the hook, at 0.54, and this arm reads ${num(value, 2)} (by seat count ` +
          `${crossRows.map((r) => `${r.seats}p ${num(r.hook, 2)}`).join('  ')}). IF THIS ARM ` +
          'MOVES THE HOOK DOWN, THE FIX HAS COST THE THING IT WAS PROTECTING. ⚠️ And only the ' +
          'TWO-SEAT column can have moved: at three and four seats this arm is rule-for-rule ' +
          'its control and the engine replays those columns byte-identically, so a difference ' +
          'there is a leak and not a finding.'
        : '');

    const detail = [
      ...(restored ? [restoredLine] : []),
      ...(restored ? [crossLine] : []),
      ...(withCentre ? [centreLine] : []),
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
        (restored ? '⭐ THE HOOK HAS A SUBJECT AGAIN (S5, 10/09/2026): ' : '') +
        `${num(value, 2)} NEIGHBOUR visits per player per turn ` +
        `(${neighbours} of ${all} visits over ${turns} turns)` +
        (withCentre
          ? `; PLUS ${centre} CENTRAL plays (${num(turns === 0 ? NaN : centre / turns, 2)} per ` +
            'turn) which have NO HOST and are deliberately NOT credited'
          : '') +
        (restored
          ? data.rules.turn.selfVisitAllowed
            ? `; self-visits take a further ${pct(all === 0 ? NaN : selves / all)} of all ` +
              'visits, RULED IN (S6) and never credited'
            : `; self-visits BANNED and reading ${selves}`
          : '') +
        (restored
          ? `; ⭐ CROSS-TABLE SHARE OF EVERY PLAY ${pct(crossTable)}` +
            (everyTargetIsAPerson ? ' against an expected 100% - every target is a PERSON' : '')
          : '') +
        (bug ? ` ⛔ AND ${selves} SELF-VISITS UNDER AN ARM THAT FORBIDS THEM (X5)` : '') +
        (leak
          ? ` ⛔ AND THE CROSS-TABLE SHARE IS NOT 100% WHERE EVERY TARGET IS A PERSON: ` +
            `${selves} self-visits and ${centre} central plays under knobs that forbid both`
          : ''),
      detail,
      verdict:
        bug || leak
          ? 'FAIL'
          : !Number.isFinite(value)
            ? 'OBSERVE'
            : value < 0.5
              ? 'FAIL'
              : 'PASS',
    };
  },
};

/**
 * ⭐ THE "NO SUBJECT" MEASUREMENT (the commons, 09/09/2026), and the pattern this
 * suite uses wherever a mode leaves a reading with nothing to measure.
 *
 * It is NOT an unmeasured value dressed up. `unmeasured()` in `types.ts` says
 * "we tried and could not"; this says "the event this counts cannot occur under
 * these rules", which is a different fact and needs a different sentence in the
 * report. Value NaN, verdict OBSERVE, and a pointer at the assertion that owns
 * the question now - because a reader who scans the suite for the hook must be
 * sent somewhere rather than left with a blank.
 */
function noSubject(games: number): Measurement {
  return {
    value: NaN,
    headline:
      'NO SUBJECT UNDER THE COMMONS: the five Notice Boards are ownerless (C1), so a play has ' +
      'no host and a visit to a NEIGHBOUR cannot happen. See a18-commons-traffic.',
    detail: [
      `⛔ THE QUANTITY IS GONE, NOT THE DESIGN. Over ${games} ended games nothing here was ` +
        'measured, and that is a structural zero rather than a solitaire table: there is no ' +
        'neighbour to visit, so a floor of 0.5 read against it would FAIL every run for ever ' +
        'and train a reader to skip the most important line in the report.',
      '⭐ a18-commons-traffic CARRIES THE INTERACTION READINGS: plays per player per turn, ' +
        'central harvests per player per game, the pile depth at harvest, and the share of ' +
        'barn cards sourced from the CENTRE against a seat’s own buildings. It ships as ' +
        'OBSERVE, because the design names no number for any of them in this pass.',
      '⚠️ NEITHER ASSERTION MAY BORROW THE OTHER’S THRESHOLD. The 0.5 floor was derived from a ' +
        'spare card funding one visit a turn; there is nothing in the commons for it to be a ' +
        'floor ON, and a number taken from the first commons run would be a snapshot test.',
      'The branches above are alive and are exercised by both controls: ' +
        'overlays/v31-card-visit.overlay.json runs the card game and ' +
        'overlays/meeple-loop-v1.overlay.json the meeple loop, where the self-visit invariant ' +
        '(X5) is still the only thing in the project that would notice it breaking.',
    ],
    verdict: 'OBSERVE',
  };
}
