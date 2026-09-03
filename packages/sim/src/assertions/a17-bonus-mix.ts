import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW IN v31 (02/09/2026), and the direct successor to the retired assertion 14
 * (see `tombstones.ts`). New id rather than a re-point, because every column of
 * the old five-way tally named a currency and all of them are gone.
 *
 * THE BONUS SLOT IS THE INTERACTION SLOT, and the number that decides every
 * version of this rule set is the visit's share of it. Four columns:
 *
 *   Draw 1         the free solitaire card - the yardstick every door must beat
 *   visit RIVAL    a card on somebody else's board: the hook
 *   visit SELF     a card on your own board: solitaire, same slot, same price
 *   SLOT UNSPENT   turns minus bonus turns, derived where it is read
 *
 * ## The verdict, and what is deliberately kept out of it
 *
 * The design's own sentence has always been about one option OUTCOMPETING the
 * visit - "if market outnumbers visit, the hook is losing" - so the rule
 * restated over the new menu is: the visit to a RIVAL must not be outnumbered
 * by the largest single solitaire option, which is Draw 1 or the self-visit.
 * That is a restatement of the design's sentence and not a number taken from
 * our own output, which is the bar ticket 11 section 2 sets.
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
 * start-of-turn window that shuts the moment the seat acts, and a term-table
 * argmax always prefers the big main action, so the evaluator had to be taught
 * to take a closing window BEFORE acting at all. What that means is that the
 * sim measures a player who never forgets. The plan wants unspent tallied
 * because a HUMAN "gets forgotten", and forgetting is a human failure a bot
 * cannot model.
 *
 * **A low unspent share here is NOT evidence that the start-of-turn restriction
 * is harmless at a table.** It is evidence that a perfectly attentive player
 * loses nothing to it. The only honest reading is the DELTA against
 * `overlays/bonus-any-time.overlay.json`, and even that bounds the rational
 * cost rather than the real one.
 *
 * ## The early/late split
 *
 * Kept from assertion 14 because the lesson it encodes was expensive: a CAPPED
 * option should spike early and then stop, and that shape is a PASS. Nothing in
 * v31's slot is capped - both options are repeatable every turn - so the split
 * now answers a different question, which is whether the self-visit is an
 * opening convenience (a seat with nothing to visit yet) or a whole-game
 * strategy. A self-visit share that is flat or RISING across the game is risk 2
 * landing; one that is front-loaded is a bootstrap.
 */
export const bonusMix: Assertion = {
  id: 17,
  title: 'The bonus mix, four ways',
  quote:
    'The bonus mix - Draw 1 / visit a neighbour / visit yourself / slot unspent. The visit ' +
    'share is still the number that decides it. A rising SLOT UNSPENT share is the ' +
    'start-of-turn restriction biting, and it is a different disease: the visit is not being ' +
    'outcompeted, it is being missed.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and part 1.1; CLAUDE.md ' +
    'watch-list item 0, re-cut for v31',
  shape:
    'The four-way tally as shares of every turn played, plus the self-visit share early ' +
    'against late.',
  threshold:
    'FAIL if the visit to a RIVAL is outnumbered by the largest single SOLITAIRE option - Draw ' +
    '1 or the self-visit. SLOT UNSPENT is reported but never carries the verdict: a forfeited ' +
    'slot did not outcompete anything, and the bots forfeit it whenever a big action is live.',
  taste: true,
  remedy:
    `${NO_REMEDY} - and the remedy depends on WHICH column won. A SELF-VISIT share that beats ` +
    'the rival visit is risk 2, whose control is rules.turn.selfVisitAllowed false and whose ' +
    'brake is rules.economy.noticeBoardThreshold ' +
    '(overlays/noticeboard-threshold-3.overlay.json). A DRAW 1 share that beats it is the free ' +
    'option being too good, whose dial is rules.turn.bonusDraw. A high UNSPENT share is the ' +
    'start-of-turn window, whose control is overlays/bonus-any-time.overlay.json.',
  measure({ pooled }) {
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

    // Early against late, per game, so games of different lengths pool.
    let selfEarly = 0;
    let selfLate = 0;
    let rivalEarly = 0;
    let rivalLate = 0;
    for (const g of games) {
      const mid = g.rounds / 2;
      for (const round of g.selfVisitRounds) {
        if (round <= mid) selfEarly += 1;
        else selfLate += 1;
      }
      for (const round of g.neighbourVisitRounds) {
        if (round <= mid) rivalEarly += 1;
        else rivalLate += 1;
      }
    }

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
        '⚠️ SLOT UNSPENT IS THE RATIONAL FLOOR, NOT A PREDICTION. The bonus slot is a ' +
          'start-of-turn window that shuts when you act, and the evaluator was taught to take a ' +
          'closing window before acting - so this measures a player who never forgets. The plan ' +
          'wants it tallied because a HUMAN forgets, and forgetting is a failure a bot cannot ' +
          'model. A LOW share here is NOT evidence that the start-of-turn rule is harmless at a ' +
          'table; it says only that a perfectly attentive player loses nothing to it. Read the ' +
          'DELTA against overlays/bonus-any-time.overlay.json, never the absolute.',
        `the self-visit, early against late: ${selfEarly} before each game's midgame, ` +
          `${selfLate} after (rival visits ${rivalEarly} / ${rivalLate}). Front-loaded is a ` +
          'bootstrap - a seat with nothing worth visiting yet. Flat or rising is risk 2 landing.',
        `mean bonus spends per game: ${num(games.length === 0 ? NaN : bonusTurns / games.length, 1)} ` +
          `of ${num(games.length === 0 ? NaN : turns / games.length, 1)} turns`,
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
    };
  },
};
