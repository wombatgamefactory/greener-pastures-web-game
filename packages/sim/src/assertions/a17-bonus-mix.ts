import { isMeepleCurrency } from '@gp/data';

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
export const bonusMix: Assertion = {
  id: 17,
  title: 'The bonus mix, four ways',
  quote:
    'The bonus mix - Draw 1 / visit a neighbour / visit yourself / slot unspent. The visit ' +
    'share is still the number that decides it. A rising SLOT UNSPENT share is the ' +
    'restriction biting, and it is a different disease: the visit is not being outcompeted, it ' +
    'is being missed. [04/09/2026, the meeple loop] Re-cut four ways: visit a rival / collect ' +
    'with meeples / collect an empty board / slot unspent. The empty-board collect is the ' +
    'solitaire line to watch.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and part 1.1; CLAUDE.md ' +
    'watch-list item 0; docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5',
  shape:
    'The four-way tally as shares of every turn played. Under visitCurrency "card": Draw 1 / ' +
    'visit a rival / visit yourself / slot unspent, plus the self-visit share early against ' +
    'late. Under "meeple": visit a rival / collect with meeples / collect an EMPTY board / slot ' +
    'unspent, plus the rival visit early against late. Re-cut for handoff v2 (04/09/2026) with ' +
    'the toll line: the share of rival visits that paid a toll to enter an occupied slot (R6 ' +
    'amended), the mean toll paid, and the most-visited seat\'s share of a game\'s rival visits.',
  threshold:
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
    'either is the bonus window, whose control is overlays/bonus-any-time.overlay.json.',
  measure(ctx) {
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

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
        "so a rising toll share is the amended R6 doing its job, not a second solitaire option. " +
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
