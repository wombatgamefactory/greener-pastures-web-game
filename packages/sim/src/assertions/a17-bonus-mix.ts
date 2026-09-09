import { isCommons, isCommonsTakeToHand, isCommonsTakeToSpend, isMeepleCurrency } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW IN v31 (02/09/2026), and the direct successor to the retired assertion 14
 * (see `tombstones.ts`). New id rather than a re-point, because every column of
 * the old five-way tally named a currency and all of them are gone.
 *
 * THE BONUS SLOT IS THE INTERACTION SLOT, and the number that decides every
 * version of this rule set is the visit's share of it.
 *
 * ## ⭐ TWO ARMS, FOUR COLUMNS EACH, AND THE SAME SENTENCE UNDER BOTH
 *
 * `rules.turn.visitCurrency` decides which four columns this tally has, and the
 * columns are NOT comparable across the knob - only the verdict rule is. Under
 * the shipped `'card'` game (the control, and every report in `reports/` before
 * 04/09/2026):
 *
 *   Draw 1         the free solitaire card - the yardstick every door must beat
 *   visit RIVAL    a card on somebody else's board: the hook
 *   visit SELF     a card on your own board: solitaire, same slot, same price
 *   SLOT UNSPENT   turns minus bonus turns, derived where it is read
 *
 * Under the meeple-loop arm (Dean, 04/09/2026):
 *
 *   COLLECT EMPTY  your own board had nothing on it, so Collect was a Draw 1
 *   visit RIVAL    a meeple onto a neighbour's slot: the hook, and the only
 *                  kind of visit there is (X5 rules out the self-visit)
 *   COLLECT MEEPLES  your own board paid you back - the host side of the loop
 *   SLOT UNSPENT   as before
 *
 * ⭐⭐ THE EMPTY-BOARD COLLECT IS THE FREE DRAW 1 UNDER A NEW NAME, and getting
 * that right is most of the point of the re-cut. R9 deletes the standalone bonus
 * draw; the only card the slot can still draw is the one attached to Collect;
 * and Collect on an empty board is explicitly legal (R7) precisely so the slot
 * is never dead. So the solitaire option did not go away - it changed its
 * spelling, and an assertion that counted "collects" as one column would report
 * the solitaire line as host-side payment and call the hook healthy.
 *
 * ⭐ A COLLECT THAT TOOK MEEPLES HOME IS NOT SOLITAIRE AND IS NOT IN THE
 * VERDICT. It is the return leg of somebody else's visit: it exists only
 * because a rival spent a meeple on you, and the meeples it banks are what you
 * spend visiting back. Counting it against the hook would score the loop's
 * second half as evidence against the loop.
 *
 * ## The verdict, and what is deliberately kept out of it
 *
 * The design's own sentence has always been about one option OUTCOMPETING the
 * visit - "if market outnumbers visit, the hook is losing" - so the rule
 * restated over each menu is: the visit to a RIVAL must not be outnumbered by
 * the largest single SOLITAIRE option. That is Draw 1 or the self-visit under
 * the control, and the empty-board collect under the arm. It is a restatement of
 * the design's sentence and not a number taken from our own output, which is the
 * bar ticket 11 section 2 sets.
 *
 * ⛔ SLOT UNSPENT IS NOT IN THE VERDICT, and that is a ruling carried whole
 * from assertion 14. A forfeited slot did not outcompete anything - the plan
 * names it a different disease in as many words - and an assertion that can
 * only ever fail measures nothing.
 *
 * ## ⚠️⚠️ THE UNSPENT NUMBER IS THE RATIONAL FLOOR, NOT A PREDICTION
 *
 * This caveat must travel with the number wherever it is printed, and it is in
 * the detail lines rather than a footnote for that reason. The bonus slot is a
 * window that shuts the moment the seat has spent it, and a term-table argmax
 * always prefers the big main action, so the evaluator had to be taught to take
 * a closing window rather than let it lapse. What the sim therefore measures is
 * a player who never forgets. The plan wants unspent tallied because a HUMAN
 * "gets forgotten", and forgetting is a human failure a bot cannot model.
 *
 * **A low unspent share here is NOT evidence that the restriction is harmless at
 * a table.** It is evidence that a perfectly attentive player loses nothing to
 * it. The only honest reading is the DELTA against
 * `overlays/bonus-any-time.overlay.json`, and even that bounds the rational cost
 * rather than the real one.
 *
 * ⚠️ UNDER THE ARM THE UNSPENT FLOOR IS STRUCTURALLY LOWER AND THAT IS NOT A
 * RESULT. Collect is legal on an empty board with any deck alive, so the slot is
 * almost never dead; under the control a seat with an empty hand and no draw had
 * nothing to spend it on at all. Expect unspent to fall between the arms for
 * that reason alone, and do not read the fall as engagement.
 *
 * ## ⭐⭐ THE COMMONS (09/09/2026): TWO COLUMNS, AND A BAND INSTEAD OF THE LAW
 *
 * Under `rules.turn.visitCurrency: 'commons'` the slot holds exactly ONE option
 * (C9): play a card onto a central board and take that board's action. There is
 * no free Draw 1, no Collect and no self-visit, so the tally is
 *
 *   COMMONS PLAY  a card onto one of the five central boards - by board, since
 *                 the board IS the action bought
 *   SLOT UNSPENT  turns minus bonus turns, derived where it is read, as always
 *
 * ⛔ **AND THE SOLITAIRE LAW HAS NO SUBJECT.** Every verdict this assertion has
 * ever carried was "the visit must not be outnumbered by the largest single
 * SOLITAIRE option", and under the commons there is no other option in the slot
 * at all - nothing to be outnumbered BY. Ratio, largest-solitaire and the
 * early/late split all go with it. Keeping the law here and reading it against
 * zero would return a triumphant PASS on a table that never plays a card, which
 * is the exact failure mode the law itself was written to stop.
 *
 * ⭐ **WHAT REPLACES IT IS DEAN'S BAND, AND IT IS A NUMBER HE SET RATHER THAN
 * ONE TAKEN FROM OUR OWN OUTPUT** - which is the bar ticket 11 section 2 sets,
 * and the first time this assertion has had a threshold that clears it cleanly.
 * Dean, 09/09/2026, on how often the bonus should be taken: *"30%-60% of the
 * time... earned, not automatic."* Both ends are live and they fail for
 * opposite reasons:
 *
 *   BELOW 30%  the fee is too dear, or the boards buy too little, and the
 *              commons is decoration. A card for an action is a trade nobody is
 *              making.
 *   ABOVE 60%  the bonus is AUTOMATIC. Dean's own word: a slot taken on three
 *              turns in five is a choice, one taken on four is a phase of the
 *              turn wearing a choice's clothes, and `rules.economy.
 *              commonsThreshold` is the one number that pulls it back (C10).
 *
 * ⚠️ **THE BAND IS READ PER SEAT COUNT AS WELL AS POOLED, AND THE PER-SEAT
 * READING IS THE ONE THAT CARRIES THE VERDICT.** The handoff's measurement plan
 * asks the question that way round - "above 60% at two players means the
 * threshold knob is the next run" - because the pool is dominated by whichever
 * seat count happens to have the most turns in it, and a 2-player game running
 * hot could hide inside a healthy pooled number. Any seat count outside the
 * band fails the assertion; the pooled figure is the headline.
 *
 * ⚠️ AND THE UNSPENT CAVEAT BELOW APPLIES WITH MORE FORCE, NOT LESS. Under the
 * commons a play COSTS A CARD, so an unspent slot is a seat that declined to pay
 * rather than one that had nothing to spend (C9's own wording). It is still the
 * rational floor and still not a prediction: a bot never forgets the slot and
 * never mis-prices a card it will want next turn.
 *
 * ## The early/late split
 *
 * Kept from assertion 14 because the lesson it encodes was expensive: a CAPPED
 * option should spike early and then stop, and that shape is a PASS. Nothing in
 * either menu is capped - every option is repeatable every turn - so the split
 * now answers a different question. Under the control it is whether the
 * self-visit is an opening convenience or a whole-game strategy. Under the arm
 * the self-visit does not exist, so what the split asks is whether the visit is
 * front-loaded (everybody starts holding five meeples, R3, so the opening is
 * artificially rich) or sustained once the loop has to feed itself.
 */
/**
 * ⭐ DEAN'S BAND, 09/09/2026, and the only threshold in this file that was set
 * by the designer rather than restated from a design sentence: *"30%-60% of the
 * time... earned, not automatic."* Both ends fail, for opposite reasons - see
 * the header. Named as constants so the report prints the same two numbers the
 * verdict is taken against.
 */
const PLAY_FLOOR = 0.3;
const PLAY_CEILING = 0.6;

export const bonusMix: Assertion = {
  id: 17,
  title: 'The bonus mix, four ways',
  quote:
    'The bonus mix - Draw 1 / visit a neighbour / visit yourself / slot unspent. The visit ' +
    'share is still the number that decides it. A rising SLOT UNSPENT share is the ' +
    'restriction biting, and it is a different disease: the visit is not being outcompeted, it ' +
    'is being missed. [04/09/2026, the meeple loop] Re-cut four ways: visit a rival / collect ' +
    'with meeples / collect an empty board / slot unspent. The empty-board collect is the ' +
    'solitaire line to watch. [09/09/2026, the commons, Dean] The bonus should be taken ' +
    '"30%-60% of the time... earned, not automatic."',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and part 1.1; CLAUDE.md ' +
    'watch-list item 0; docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5; ' +
    'docs/commons-handoff-2026-09-09-v1.md section 2.7 and the measurement plan (section 3), ' +
    'carrying Dean’s band of 09/09/2026',
  shape:
    'The four-way tally as shares of every turn played. Under visitCurrency "card": Draw 1 / ' +
    'visit a rival / visit yourself / slot unspent, plus the self-visit share early against ' +
    'late. Under "meeple": visit a rival / collect with meeples / collect an EMPTY board / slot ' +
    'unspent, plus the rival visit early against late. Re-cut for handoff v2 (04/09/2026) with ' +
    'the toll line: the share of rival visits that paid a toll to enter an occupied slot (R6 ' +
    'amended), the mean toll paid, and the most-visited seat’s share of a game’s rival visits. ' +
    'Under "commons" it is TWO columns - commons play / slot unspent - as shares of every turn ' +
    'played, split by BOARD (the board is the action bought) and reported per seat count as ' +
    'well as pooled.',
  threshold:
    `Under "commons": FAIL if the PLAY RATE - the share of turns that play a card onto a ` +
    `central board - falls outside ${pct(PLAY_FLOOR, 0)} to ${pct(PLAY_CEILING, 0)} at ANY ` +
    'seat count or pooled. Dean set that band on 09/09/2026 ("30%-60% of the time... earned, ' +
    'not automatic"): below it the fee is too dear and the commons is decoration, above it the ' +
    'bonus is automatic and rules.economy.commonsThreshold is the number that pulls it back. ' +
    'The solitaire law has NO SUBJECT under the commons - the slot holds one option (C9), so ' +
    'there is nothing for the play to be outnumbered by, and reading the law against zero ' +
    'would return a PASS on a table that never played a card. ' +
    'FAIL if the visit to a RIVAL is outnumbered by the largest single SOLITAIRE option. Under ' +
    '"card" that is Draw 1 or the self-visit; under "meeple" it is the empty-board collect, ' +
    'which is what the free Draw 1 became (R9 deletes the standalone draw, R7 keeps the one ' +
    'attached to Collect). A collect that took meeples home is the host side of the loop and is ' +
    'NOT counted as solitaire. SLOT UNSPENT is reported but never carries the verdict: a ' +
    'forfeited slot did not outcompete anything, and the bots forfeit it whenever a big action ' +
    'is live.',
  taste: true,
  remedy:
    `${NO_REMEDY} - and the remedy depends on WHICH column won. Under "card": a SELF-VISIT ` +
    'share that beats the rival visit is risk 2, whose control is rules.turn.selfVisitAllowed ' +
    'false and whose brake is rules.economy.noticeBoardThreshold; a DRAW 1 share that beats it ' +
    'is the free option being too good, whose dial is rules.turn.bonusDraw. Under "meeple": an ' +
    'EMPTY-BOARD COLLECT share that beats the rival visit says the loop is not feeding itself, ' +
    'and the dials are rules.turn.bonusDraw (the draw attached to Collect - the same knob, now ' +
    'pricing the same solitaire line under a new name) and rules.turn.startingMeeplesPerColour ' +
    '(overlays/meeple-loop-no-starting-meeples-v1.overlay.json). A high UNSPENT share under ' +
    'either is the bonus window, whose control is overlays/bonus-any-time.overlay.json. ' +
    'Under "commons" the band has a knob at each end. ABOVE 60%: ' +
    'npm run sim -- --watchlist --overlay=overlays/commons-threshold-2.overlay.json   ' +
    '(rules.economy.commonsThreshold 2, which refuses a play onto a pile already that deep - ' +
    'C10, built for exactly this reading). BELOW 30%: the fee is buying too little, and the ' +
    'arm is overlays/commons-draw-three.overlay.json (the one contested door choice, Draw 3 ' +
    'against the shipped Draw 2); the turn-order control beside it is ' +
    'overlays/commons-bonus-last.overlay.json, because a bonus taken BEFORE the main action ' +
    'is a different offer from one taken after (C2).',
  measure(ctx) {
    if (isCommons(ctx.data)) return commonsMode(ctx);
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/**
 * ⭐ DEAN'S VARIANTS' OTHER FREE OPTION (09/09/2026, `commonsTake: 'bonus'` OR
 * `'spend'`): how much of the SLOT'S ACTUAL USE was the free take rather than
 * the paid play. Not part of the verdict - see `commonsMode`'s own comment on
 * why - printed as the line that watches the solitaire law under a new name.
 */
function freeShareLine(plays: number, takes: number): string {
  const used = plays + takes;
  return (
    `⭐ THE FREE OPTION'S SHARE OF USED SLOTS: ${pct(used === 0 ? NaN : takes / used)} ` +
    `(${takes} takes of ${used} used slots, plays and takes together). This is the solitaire ` +
    'law arriving under a new name: every currency this project has shipped has watched whether ' +
    'a free option sharing the bonus slot with a paid one crowds it out (Draw 1 against the ' +
    "card visit, the empty-board Collect against the meeple visit), and commonsTake: 'bonus' or " +
    "'spend' puts a free option back in the slot beside the paid commons play for the first time " +
    "since the commons shipped. ⚠️ OBSERVE, NOT FAIL: Dean set a band for the slot's OVERALL use " +
    'rate (play or take together), not for the split between the two, so a high free share is a ' +
    'reading to watch rather than a threshold this assertion can fail on.'
  );
}

/**
 * ⭐ THE COMMONS (C1-C10, 09/09/2026): two columns and Dean's band.
 *
 * The per-seat-count rows are computed first and the pooled figure second, and
 * the verdict reads BOTH: any seat count outside the band fails, because the
 * handoff's own measurement plan asks the question per seat count ("above 60% at
 * two players means the threshold knob is the next run") and a pooled number
 * hides a hot 2-player table inside a healthy average.
 */
function commonsMode({ data, pooled }: MeasureContext): Measurement {
  const takeToHand = isCommonsTakeToHand(data);
  const takeToSpend = isCommonsTakeToSpend(data);
  // ⭐ BOTH VARIANTS PRINT THE SAME THREE-COLUMN SHAPE (Dean, 09/09/2026): a
  // free `commonsTake` sharing the slot with the paid `commons` play. They
  // differ only in what a take's cards then DO, which a17 does not need to
  // know - see a18 for that.
  const threeColumn = takeToHand || takeToSpend;
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);
  const plays = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
  // ⭐ THE FREE HALF OF THE SLOT. 0 by construction under the shipped
  // `'harvest'` rule, where `commonsTake` moves are never enumerated. Under
  // `'bonus'` every take lands in a hand and `commonsTakesBySeat` (off
  // `commonsTaken`) counts all five boards; under `'spend'` that same counter
  // sees ONLY the orchard and wheat legs (the two `commonsTaken`-emitting
  // ones), so the total has to come off `commonsSpendTakesByBoard` instead -
  // a MOVE-level count that sees all five boards a take can choose.
  const takes = takeToHand
    ? sum(games.map((g) => sum(g.commonsTakesBySeat)))
    : takeToSpend
      ? sum(games.map((g) => sum(Object.values(g.commonsSpendTakesByBoard))))
      : 0;
  const unspent = Math.max(0, turns - bonusTurns);

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  // THE VERDICT IS TAKEN ON TURNS THAT USED THE SLOT, not on plays per turn.
  // Dean's band is "gives you a bonus action 30%-60% of the time", which is a
  // share of TURNS. A Helping Hand grants a second play (C8), so plays per turn
  // runs above it - 68.5% against 58.9% on the reference-v15 baseline of
  // 09/09/2026 - and judging plays per turn would fail a table for owning a card.
  // Both are printed; only the turn share carries the verdict (corrected
  // 09/09/2026, after the first baseline was read on the wrong quantity).
  //
  // ⭐ AND UNDER commonsTake: 'bonus' "USED" MEANS PLAY OR TAKE, NOT PLAY
  // ALONE: `bonusTurnsBySeat` counts a turn as a bonus turn on EITHER move
  // (see observe.ts's `turnEnded` fold), so this ratio and the band it is
  // read against are unchanged in shape - only the menu behind "used" grew a
  // free half.
  const value = bonusTurns / turns;
  const playsPerTurn = plays / turns;

  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const t = totalTurns(slice.ended);
      const p = sum(slice.ended.map((g) => sum(g.commonsPlaysBySeat)));
      const k = takeToHand
        ? sum(slice.ended.map((g) => sum(g.commonsTakesBySeat)))
        : takeToSpend
          ? sum(slice.ended.map((g) => sum(Object.values(g.commonsSpendTakesByBoard))))
          : 0;
      const b = totalBonusTurns(slice.ended);
      return {
        seats: slice.seats,
        turns: t,
        rate: t === 0 ? NaN : b / t,
        playsPerTurn: t === 0 ? NaN : p / t,
        takesPerTurn: t === 0 ? NaN : k / t,
        unspent: t === 0 ? NaN : Math.max(0, t - b) / t,
      };
    });

  // By BOARD, which under the commons is by ACTION: the board decides what the
  // play buys (C3), so this row is the door mix asked of the plays rather than
  // of the door uses. a07 owns the door mix itself and reads a different table.
  // ⚠️ PAID PLAYS ONLY, even under `commonsTake: 'bonus'` - a take buys no
  // action (it is a free draw of a chosen pile), so it has no door to mix into.
  const byBoard = new Map<string, number>();
  for (const g of games) {
    for (const [board, n] of Object.entries(g.commonsPlaysByBoard)) {
      byBoard.set(board, (byBoard.get(board) ?? 0) + n);
    }
  }
  const boardLine = [...byBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(plays === 0 ? NaN : n / plays, 0)}`)
    .join('  ');

  const outOfBand = rows.filter((r) => Number.isFinite(r.rate) && outside(r.rate));
  const verdict: Measurement['verdict'] = !Number.isFinite(value)
    ? 'OBSERVE'
    : outside(value) || outOfBand.length > 0
      ? 'FAIL'
      : 'PASS';

  const headline = threeColumn
    ? `the bonus slot is used on ${pct(value)} of ${turns} turns ` +
      `(Dean's band ${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)}); ` +
      `PLAY ${share(plays)}, TAKE ${share(takes)}, SLOT UNSPENT ${share(unspent)}` +
      (outOfBand.length === 0
        ? ''
        : `; OUT OF BAND at ${outOfBand.map((r) => `${r.seats}p ${pct(r.rate)}`).join(', ')}`)
    : `the bonus slot is used on ${pct(value)} of ${turns} turns ` +
      `(Dean's band ${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)}); plays per turn ${pct(playsPerTurn)} ` +
      `(A Helping Hand's second play is the difference); SLOT UNSPENT ${share(unspent)}` +
      (outOfBand.length === 0
        ? ''
        : `; OUT OF BAND at ${outOfBand.map((r) => `${r.seats}p ${pct(r.rate)}`).join(', ')}`);

  // ⭐ DEAN'S 'spend' VARIANT'S OWN LINE (09/09/2026): takes by board, off
  // `commonsSpendTakesByBoard` - the only counter that sees all five boards a
  // `commonsTake` move can choose under this knob, where `commonsTaken` (and
  // so the "by BOARD PLAYED" line's sibling) only ever fires for orchard and
  // wheat. a18 carries what each board's take then DID with its pile.
  const spendTakesByBoard = new Map<string, number>();
  if (takeToSpend) {
    for (const g of games) {
      for (const [board, n] of Object.entries(g.commonsSpendTakesByBoard)) {
        spendTakesByBoard.set(board, (spendTakesByBoard.get(board) ?? 0) + n);
      }
    }
  }
  const spendTakesByBoardLine = [...spendTakesByBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(takes === 0 ? NaN : n / takes, 0)}`)
    .join('  ');

  const detail = threeColumn
    ? [
        `⭐ DEAN'S VARIANT (rules.turn.commonsTake: '${takeToHand ? 'bonus' : 'spend'}', ` +
          '09/09/2026): THREE columns rather than two, as a share of every turn played: PLAY ' +
          `${share(plays)} (a card paid, a board's action bought), TAKE ${share(takes)} (a whole ` +
          `central pile taken free${takeToHand ? ' to hand' : ", one board's action bought from what it holds"} - no card, no fee), ` +
          `SLOT UNSPENT ${share(unspent)}.`,
        `by seat count, and THIS is the reading the verdict is taken on (slot used = play or ` +
          `take; play/take per turn in brackets): ${rows
            .map(
              (r) =>
                `${r.seats}p ${pct(r.rate)} (${pct(r.playsPerTurn)} play, ${pct(r.takesPerTurn)} take) of ${r.turns} turns`,
            )
            .join('   ')}. The handoff asks the question this way round because a hot ` +
          '2-player table hides inside a healthy pool.',
        `slot unspent by seat count: ${rows.map((r) => `${r.seats}p ${pct(r.unspent)}`).join('  ')}`,
        `by BOARD PLAYED (the PAID half only, C3): ${boardLine || 'no plays'}. ${plays} plays ` +
          `over ${games.length} games, ${num(games.length === 0 ? NaN : plays / games.length, 1)} ` +
          'a game.' +
          (takeToHand
            ? ' A take buys no action, so it has no board mix of its own - a18 carries the ' +
              'take-size distribution instead.'
            : ''),
        ...(takeToSpend
          ? [
              `⭐ TAKES BY BOARD (rules.turn.commonsTake: 'spend', 09/09/2026), ALL FIVE, not the ` +
                `PAID half above: ${spendTakesByBoardLine || 'no takes'}. ${takes} takes over ` +
                `${games.length} games, ${num(games.length === 0 ? NaN : takes / games.length, 1)} ` +
                'a game. Orchard takes go to hand and wheat takes to barn exactly as under ' +
                "'bonus'; dairy, vegetable and apiary each spend the pile on that board's own " +
                'action instead - a18 carries what each one did with it (used / discarded / ' +
                'stranded).',
            ]
          : []),
        `⭐ DEAN'S BAND, 09/09/2026, AND IT IS HIS NUMBER RATHER THAN ONE READ OFF OUR OWN ` +
          `OUTPUT: the bonus should be taken "${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)} of ` +
          'the time... earned, not automatic". It is read on the slot\'s TOTAL use (play plus ' +
          "take), because Dean's sentence is about the slot being spent at all, not about which " +
          'half of it did the spending.',
        freeShareLine(plays, takes),
        UNSPENT_CAVEAT,
        '⚠️ AND UNDER THE COMMONS THE UNSPENT COLUMN MEANS SOMETHING SHARPER THAN UNDER EITHER ' +
          'CONTROL: a PLAY costs a card, though a TAKE costs nothing at all - so an unspent slot ' +
          'here is a seat that declined even the free option, which is a stronger finding than ' +
          'declining a paid one.',
        perGameLine(games.length, bonusTurns, turns),
      ]
    : [
        `the two-column tally, as a share of every turn played: SLOT USED ${pct(value)} ` +
          `(${share(plays)} plays per turn), SLOT UNSPENT ${share(unspent)}. There is no third column: the slot holds one option ` +
          '(C9) - no free Draw 1, no Collect, no self-visit - so an unspent slot is a turn that ' +
          'chose not to pay a card, and nothing else.',
        `by seat count, and THIS is the reading the verdict is taken on (slot used; plays per turn in brackets): ${rows
          .map((r) => `${r.seats}p ${pct(r.rate)} (${pct(r.playsPerTurn)}) of ${r.turns} turns`)
          .join('   ')}. The handoff asks the question this way round because a hot 2-player ` +
          'table hides inside a healthy pool.',
        `slot unspent by seat count: ${rows.map((r) => `${r.seats}p ${pct(r.unspent)}`).join('  ')}`,
        `by BOARD, which is by ACTION (C3): ${boardLine || 'no plays'}. ` +
          `${plays} plays over ${games.length} games, ` +
          `${num(games.length === 0 ? NaN : plays / games.length, 1)} a game. Watch Deliver ` +
          '(vegetable took 8% of door uses under the meeples) and whether Draw 2 (orchard) is ' +
          'dead now that the fee is a card and the board hands back two.',
        `⭐ DEAN'S BAND, 09/09/2026, AND IT IS HIS NUMBER RATHER THAN ONE READ OFF OUR OWN ` +
          `OUTPUT: the bonus should be taken "${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)} of ` +
          'the time... earned, not automatic". BELOW the floor the fee is too dear or the boards ' +
          'buy too little and the commons is decoration; ABOVE the ceiling the bonus is a phase ' +
          'of the turn rather than a choice, and rules.economy.commonsThreshold (C10) is the one ' +
          'number that pulls it back.',
        '⛔ THE SOLITAIRE LAW HAS NO SUBJECT HERE, and that is why this arm reports a BAND rather ' +
          'than a ratio. Every previous verdict in this file was "the visit must not be ' +
          'outnumbered by the largest single SOLITAIRE option"; the commons slot has no second ' +
          'option to be outnumbered by, so the law would read against zero and hand a table that ' +
          'never plays a card a triumphant PASS. The early/late split goes with it for the same ' +
          'reason: it asked whether a solitaire alternative was an opening convenience. ⭐ IT ' +
          "COMES BACK UNDER commonsTake: 'bonus' OR 'spend' - see that arm's own detail lines.",
        '⚠️ A TURN CAN PLAY TWICE. A Helping Hand grants a second play onto a central board (C8), ' +
          'so PLAYS PER TURN runs above the share of turns that used the slot. The VERDICT is ' +
          'taken on the turn share (slot used plus slot unspent is every turn); plays per turn ' +
          'is printed beside it so a Helping Hand cannot fail the band on its own. Corrected ' +
          '09/09/2026: the first reference-v15 baseline was judged on plays per turn (68.5%) ' +
          'when the turn share read 58.9%.',
        UNSPENT_CAVEAT,
        '⚠️ AND UNDER THE COMMONS THE UNSPENT COLUMN MEANS SOMETHING SHARPER THAN UNDER EITHER ' +
          'CONTROL: a play COSTS A CARD, so an unspent slot is a seat that declined to pay rather ' +
          'than one that had nothing to spend. It is still the rational floor - a bot never ' +
          'forgets a slot and never mis-prices a card it will want next turn - so read it as the ' +
          'cheapest the restriction can possibly be, never as what a table will do.',
        perGameLine(games.length, bonusTurns, turns),
      ];

  return { value, headline, detail, verdict };
}

function outside(rate: number): boolean {
  return rate < PLAY_FLOOR || rate > PLAY_CEILING;
}

/** The shipped v31 game, unchanged since 02/09/2026 and deliberately not re-derived. */
function cardGame({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);

  const draws = sum(games.map((g) => sum(g.bonusDrawBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const all = sum(games.map((g) => sum(g.visitsBySeat)));
  const rivals = all - selves;
  // Turns minus bonus turns, and never stored anywhere: a remainder that is
  // counted separately is a remainder that can drift out of step with the
  // count it is a remainder OF.
  const unspent = Math.max(0, turns - bonusTurns);

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  const solitaire: [string, number][] = [
    ['Draw 1', draws],
    ['visit yourself', selves],
  ];
  const [worstName, worst] = solitaire.reduce((a, b) => (b[1] > a[1] ? b : a));
  const value = rivals === 0 ? (worst > 0 ? Infinity : NaN) : worst / rivals;

  const split = earlyLate(games, (g) => g.selfVisitRounds);
  const rivalSplit = earlyLate(games, (g) => g.neighbourVisitRounds);

  return {
    value,
    headline:
      `visit a rival takes ${share(rivals)} of ${turns} turns, biggest solitaire option ` +
      `${worstName} at ${share(worst)}; SLOT UNSPENT ${share(unspent)}`,
    detail: [
      `the four-way tally, as a share of every turn played: Draw 1 ${share(draws)}, ` +
        `visit a rival ${share(rivals)}, visit YOURSELF ${share(selves)}, ` +
        `SLOT UNSPENT ${share(unspent)}`,
      `visit share of the slots that WERE spent: ` +
        `${pct(bonusTurns === 0 ? NaN : rivals / bonusTurns)} of ${bonusTurns} ` +
        `(self-visits take a further ${pct(bonusTurns === 0 ? NaN : selves / bonusTurns)})`,
      UNSPENT_CAVEAT,
      `the self-visit, early against late: ${split.early} before each game's midgame, ` +
        `${split.late} after (rival visits ${rivalSplit.early} / ${rivalSplit.late}). ` +
        'Front-loaded is a bootstrap - a seat with nothing worth visiting yet. Flat or rising ' +
        'is risk 2 landing.',
      perGameLine(games.length, bonusTurns, turns),
    ],
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
  };
}

/** The meeple-loop arm (04/09/2026). Same sentence, different menu. */
function meepleArm({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);

  const rivals = sum(games.map((g) => sum(g.visitsBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const withMeeples = sum(games.map((g) => sum(g.collectsWithMeeplesBySeat)));
  const empty = sum(games.map((g) => sum(g.collectsEmptyBySeat)));
  const unspent = Math.max(0, turns - bonusTurns);
  const wild = sum(games.map((g) => sum(g.wildVisitsBySeat)));
  // ⭐ THE TOLL LINE (R6 amended, handoff v2 section 3.7): what share of every
  // rival visit paid something to enter an already-occupied slot. Zero by
  // construction whenever `rules.turn.slotToll` is null (the v1 default),
  // because `visitToll` never fires there and an occupied slot still refuses
  // the colour outright instead.
  const tollVisits = sum(games.map((g) => sum(g.tollVisitsBySeat)));
  const tollPaid = sum(games.map((g) => sum(g.tollMeeplesPaidBySeat)));
  const toll = data.rules.turn.slotToll;

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  // ONE solitaire column under the arm, and naming it in a list of one is
  // deliberate: it keeps the verdict's shape identical to the control's, so a
  // second solitaire option (a knob that made an empty collect draw more, say)
  // is added to the list rather than rewritten around.
  const solitaire: [string, number][] = [['collect an EMPTY board', empty]];
  const [worstName, worst] = solitaire.reduce((a, b) => (b[1] > a[1] ? b : a));
  const value = rivals === 0 ? (worst > 0 ? Infinity : NaN) : worst / rivals;
  const split = earlyLate(games, (g) => g.neighbourVisitRounds);

  const detail = [
    `the four-way tally, as a share of every turn played: visit a rival ${share(rivals)}, ` +
      `collect WITH meeples ${share(withMeeples)}, collect an EMPTY board ${share(empty)}, ` +
      `SLOT UNSPENT ${share(unspent)}`,
    `visit share of the slots that WERE spent: ` +
      `${pct(bonusTurns === 0 ? NaN : rivals / bonusTurns)} of ${bonusTurns}; collects take ` +
      `${pct(bonusTurns === 0 ? NaN : (withMeeples + empty) / bonusTurns)}, of which ` +
      `${pct(withMeeples + empty === 0 ? NaN : empty / (withMeeples + empty))} were empty boards`,
    '⚠️ THESE FOUR SHARES DO NOT SUM TO 100% AND ARE NOT MEANT TO. A Helping Hand (R11) grants ' +
      'BOTH bonus options in one turn - one Visit and one Collect - so a turn can appear in two ' +
      'columns at once, while SLOT UNSPENT is one per turn. The columns are shares of TURNS, ' +
      'not slices of a pie, and the same is true of the control arm’s four. Read each against ' +
      'the others, never as parts of a whole.',
    '⭐ THE EMPTY-BOARD COLLECT IS THE FREE DRAW 1 UNDER A NEW NAME (R9 deletes the standalone ' +
      'draw, R7 keeps the one attached to Collect and makes collecting nothing explicitly ' +
      'legal), which is why it and not "collects" carries the verdict. A collect that took ' +
      'meeples home is the return leg of a rival’s visit and is NOT solitaire.',
    `${wild} of ${rivals} visits were paid with a WILD PAIR ` +
      `(${pct(rivals === 0 ? NaN : wild / rivals)}); assertion 7 owns that number and the ` +
      'open question it decides - colour-keyed slots against five unkeyed spaces.',
    toll === null
      ? '⭐ TOLL VISITS (R6 amended, handoff v2 section 3.7): 0, by construction - ' +
        '`rules.turn.slotToll` is null under this run, so an occupied slot still refuses that ' +
        'colour outright (v1) rather than pricing it, and `visitToll` never fires.'
      : `⭐ TOLL VISITS (R6 amended, handoff v2 section 3.7): ${tollVisits} of ${rivals} rival ` +
        `visits paid a toll (${pct(rivals === 0 ? NaN : tollVisits / rivals)}), ${tollPaid} ` +
        `toll meeples in all (mean ${num(tollVisits === 0 ? NaN : tollPaid / tollVisits, 2)} ` +
        `per toll visit, against a printed rate of ${toll} extra meeple(s) per occupant). The ` +
        'toll is a SINK, not a payment to the host - it goes to the box, never into the slot - ' +
        'so a rising toll share is the amended R6 doing its job, not a second solitaire option. ' +
        'Assertion 15 carries the same meeples counted from the payer’s side and the pool line ' +
        'they drain into.',
    receivedSpreadLine(games, rivals),
    UNSPENT_CAVEAT,
    '⚠️ AND UNDER THIS ARM THE UNSPENT FLOOR IS STRUCTURALLY LOWER, which is not a result. ' +
      'Collect is legal on an empty board whenever any deck is alive, so the slot is almost ' +
      'never dead; under the control a seat with an empty hand and nothing to draw had no ' +
      'option at all. Expect unspent to fall between the arms for that reason alone.',
    `the rival visit, early against late: ${split.early} before each game's midgame, ` +
      `${split.late} after. Every seat starts holding one meeple of each colour (R3), so the ` +
      'opening is artificially rich; front-loaded says the loop is not feeding itself once the ' +
      'starting five have been spent, which is the same finding as a high empty-collect share ' +
      'arriving from the other direction.',
    `⭐ SELF-VISITS: ${selves}, and anything but 0 is an engine bug (X5 rules out the ` +
      'self-visit under any flag). Assertion 8 owns that invariant and fails on it.',
    perGameLine(games.length, bonusTurns, turns),
  ];

  return {
    value,
    headline:
      `visit a rival takes ${share(rivals)} of ${turns} turns, biggest solitaire option ` +
      `${worstName} at ${share(worst)}; SLOT UNSPENT ${share(unspent)}`,
    detail,
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
  };
}

const UNSPENT_CAVEAT =
  '⚠️ SLOT UNSPENT IS THE RATIONAL FLOOR, NOT A PREDICTION. The bonus slot is a window that ' +
  'shuts when it is spent, and the evaluator was taught to take a closing window rather than ' +
  'let it lapse - so this measures a player who never forgets. The plan wants it tallied ' +
  'because a HUMAN forgets, and forgetting is a failure a bot cannot model. A LOW share here ' +
  'is NOT evidence that the restriction is harmless at a table; it says only that a perfectly ' +
  'attentive player loses nothing to it. Read the DELTA against ' +
  'overlays/bonus-any-time.overlay.json, never the absolute.';

function perGameLine(games: number, bonusTurns: number, turns: number): string {
  return (
    `mean bonus spends per game: ${num(games === 0 ? NaN : bonusTurns / games, 1)} ` +
    `of ${num(games === 0 ? NaN : turns / games, 1)} turns`
  );
}

/**
 * ⭐ THE SPREAD OF VISITS RECEIVED, BY SEAT (handoff v2 section 3.7: "does the
 * popular farm change hands"). For each game, the MOST-visited seat's share of
 * that game's rival visits, against an even share (1 / seat count). Pooled
 * across games, mean and even-share side by side.
 *
 * ⚠️ THIS MEASURES CONCENTRATION, NOT ROTATION, and that limit is honest
 * rather than hidden: a share sitting near even could still be the SAME seat
 * being visited most every game (a stable favourite) or a DIFFERENT seat each
 * game (a genuinely changing hand) - `visitsReceivedBySeat` alone cannot tell
 * the two apart, and neither reading is invented here. A share sitting well
 * ABOVE even is the one thing this line can say cleanly: some seat's board is
 * a materially more popular target than the rest, whoever it is.
 */
function receivedSpreadLine(games: readonly GameMetrics[], rivals: number): string {
  const shares: number[] = [];
  const evenShares: number[] = [];
  for (const g of games) {
    const received = g.visitsReceivedBySeat.slice(0, g.seats);
    const total = received.reduce((a, b) => a + b, 0);
    if (total === 0 || g.seats === 0) continue;
    shares.push(Math.max(...received) / total);
    evenShares.push(1 / g.seats);
  }
  const meanShare = shares.length === 0 ? NaN : shares.reduce((a, b) => a + b, 0) / shares.length;
  const meanEven =
    evenShares.length === 0 ? NaN : evenShares.reduce((a, b) => a + b, 0) / evenShares.length;
  return (
    `the most-visited seat's share of its own game's rival visits, mean across ${shares.length} ` +
    `games with at least one: ${pct(meanShare)} (an even share at this table size would be ` +
    `${pct(meanEven)}, of ${rivals} rival visits pooled). Read as CONCENTRATION, not rotation - ` +
    'see the field comment for the distinction this line cannot make on its own.'
  );
}

/** Rounds before and after each game's own midgame, so games of different lengths pool. */
function earlyLate(
  games: readonly GameMetrics[],
  pick: (g: GameMetrics) => readonly number[],
): { early: number; late: number } {
  let early = 0;
  let late = 0;
  for (const g of games) {
    const mid = g.rounds / 2;
    for (const round of pick(g)) {
      if (round <= mid) early += 1;
      else late += 1;
    }
  }
  return { early, late };
}
