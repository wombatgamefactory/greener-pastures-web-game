import { isMeepleCurrency } from '@gp/data';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW IN v31 (02/09/2026): ACTIONS RESOLVED PER TURN. RE-CUT 04/09/2026
 * (handoff v2 preamble) - THE TARGET MOVES FROM 2.0 TO 1.5, AND WHAT COUNTS AS
 * AN "ACTION" CHANGES WITH IT.
 *
 * ⭐ **THIS IS THE NUMBER THE WHOLE PASS MOVES, AND NOTHING MEASURED IT.** The
 * plan says so outright (risk 1) and `rules.json` repeats it in its own
 * `unresolved` list: *"actions resolved per turn is the number this entire pass
 * moves and nothing in the suite currently measures it. It has to be measured
 * BEFORE deliveriesToTrigger is dialled, or the dial will be set against an
 * unknown."*
 *
 * ## ⭐⭐ WHY 1.5, AND WHY IT IS THE SAME NUMBER AS THE HOOK'S FLOOR
 *
 * The handoff v2 preamble states this plainly: *"At one main action a turn,
 * the 1.5 target and the 0.5 hook floor are the same number."* Here is the
 * arithmetic that sentence is shorthand for. One core action is taken every
 * turn, by rule - that is 1.0. `a08-the-hook` sets 0.5 NEIGHBOUR visits per
 * player per turn as its own floor, and under this arm a door action IS a
 * visit (X5: no self-visit under any flag, so `boughtDoorActionsBySeat` and
 * a08's neighbour-visit count are the same population). So the floor this
 * assertion now measures is arithmetically `1.0 (main action) + 0.5 (a08's
 * hook floor) = 1.5`, and reading a FAIL here is not a second, independent
 * finding - it is a08's failure re-expressed through the turn's own ledger. If
 * a08 already reads below 0.5, this assertion will read below 1.5 for the
 * identical reason, and the two together confirm the shortfall is a real one
 * rather than a fold artefact in either counter.
 *
 * ## What counts, and what deliberately does not
 *
 * `mainActionsBySeat` (`observe.ts`): ONE per turn, by rule - draw, build,
 * grow, harvest, deliver, moveBalloon, whichever the seat took. Plus
 * `boughtDoorActionsBySeat`: every `doorUsed` event, whichever route paid for
 * it - a card fee under `visitCurrency: 'card'`, a meeple visit under
 * `'meeple'`. **COLLECT AND THE FREE DRAW 1 ARE DELIBERATELY EXCLUDED and
 * printed on their OWN LINE instead** (handoff v2 preamble): drawing a card is
 * not the core-action-and-a-half this assertion exists to watch, and folding
 * it back in would return to exactly the inflated reading the 04/09/2026
 * re-cut was written to stop. A card effect that draws or sows inside another
 * action is not counted either: it is part of the action that fired it, and
 * counting it would turn "actions per turn" into "things that happened per
 * turn", a different and much less useful number. `pass` counts nothing,
 * because nothing was resolved.
 *
 * ⚠️ THIS IS A REDEFINITION, NOT A RE-DERIVATION OF THE SAME NUMBER. The
 * pre-04/09/2026 assertion pooled the main action, every door, every Collect
 * and every free Draw 1 into one `actionsBySeat` total and printed 2.0 as
 * "one action, one bonus". `actionsBySeat` itself is untouched in `observe.ts`
 * - `report.ts` still reads its own unchanged reading from it - but this
 * assertion no longer reads it. The number below WILL sit visibly lower than
 * any report printed before this re-cut for that reason alone, and that is
 * not itself a regression: it is the same turns counted a narrower way, on
 * Dean's own instruction.
 *
 * ## The threshold, and why it is a floor now rather than an expectation
 *
 * FAIL below 1.5 (the door - the hook - is being bought on materially fewer
 * than half of all turns, restated through the action ledger). The FAT
 * ceiling of 2.5 is kept from the pre-recut assertion as a bug detector rather
 * than re-derived: under this narrower definition a turn buys at most one main
 * action plus one door by rule, so anything approaching 2.5 is A Helping Hand
 * (R11, which grants a second bonus option) firing on an implausibly large
 * share of turns, or an engine bug double-counting a door. It is not "the
 * meeple supply running away" - that uncapped term has no route left under
 * this arm (R8 deletes the turn-start meeple spend), and the pre-recut
 * assertion already made that point about its OWN ceiling; it applies with
 * more force now that Collect can no longer inflate the count either.
 *
 * ⚠️ READ IT WITH GAME LENGTH, ALWAYS. A high rate with a short game is the
 * change working as designed; a high rate with an UNCHANGED game length means
 * the extra actions went somewhere other than the island, and that is the more
 * worrying reading.
 *
 * ⚠️ UNCHANGED IN SHAPE ACROSS visitCurrency: the same two counters
 * (`mainActionsBySeat`, `boughtDoorActionsBySeat`) exist under `'card'` too, so
 * the control's own reading moves under this re-cut exactly as the arm's does,
 * for the same reason - Collect does not exist under `'card'`, but the free
 * Draw 1 (`bonusDrawBySeat`) is excluded there in its place.
 */
const TARGET = 1.5;
const FAT = 2.5;

export const actionInflation: Assertion = {
  id: 16,
  title: 'Action inflation',
  quote:
    'Risk 1 - action inflation. The bonus slot now buys a full core action for one card - the ' +
    'Wheat door is a free Harvest, the Dairy door a free Build - and meeples add uncapped free ' +
    'actions on top. Turns are materially more powerful than v30s. Expect a shorter game and ' +
    'higher scores. The end trigger stays at 6 and is the first knob to sweep. [04/09/2026, ' +
    'handoff v2 preamble] The action target is 1.5, not 2.0. At one main action a turn, the 1.5 ' +
    'target and the 0.5 hook floor are the same number.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4, risk 1; ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5 (item 4, read with game ' +
    'length); docs/meeple-loop-visit-handoff-2026-09-04-v2.md preamble',
  shape:
    'Core actions resolved per player per turn: the ONE main action every turn takes by rule, ' +
    'plus every BOUGHT DOOR (a visit, whichever currency paid for it). Collect and the free ' +
    'Draw 1 are reported on their own line and no longer folded into the count. Unchanged in ' +
    'shape across visitCurrency: the same two counters exist under "card" and "meeple" alike.',
  threshold:
    `FAIL below ${TARGET} (one main action plus a door bought on materially fewer than half of ` +
    `all turns - the same shortfall a08's 0.5 hook floor would already report) or above ${FAT} ` +
    "(more doors are being bought than one main action's worth of turns can plausibly explain, " +
    'which is A Helping Hand on an implausible share of turns or an engine bug). The printed ' +
    'target is 1.5: one action, one door, at the hook’s own floor.',
  taste: true,
  remedy:
    'npm run sim -- --watchlist --overlay=overlays/end-trigger-8.overlay.json   ' +
    `(rules.endGame.deliveriesToTrigger 8 against the shipped 6 - the only number that ` +
    'lengthens the game without changing what anything is worth). ' +
    `${NO_REMEDY} for the rate itself: a FAIL here is a08's own failure re-expressed, so the ` +
    'remedy belongs to a08 - the door rate is the design, not a knob on this assertion.',
  measure({ data, pooled }) {
    const arm = isMeepleCurrency(data);
    const games = pooled.ended;
    const turns = sum(games.map((g) => sum(g.turnsBySeat)));
    const mainActions = sum(games.map((g) => sum(g.mainActionsBySeat)));
    const doorActions = sum(games.map((g) => sum(g.boughtDoorActionsBySeat)));
    const actions = mainActions + doorActions;
    // Collect (the arm) or the free Draw 1 (the control) - printed apart, per
    // the handoff's own instruction, never summed into `actions` above.
    const draws = arm
      ? sum(games.map((g) => sum(g.collectsWithMeeplesBySeat) + sum(g.collectsEmptyBySeat)))
      : sum(games.map((g) => sum(g.bonusDrawBySeat)));
    const value = turns === 0 ? NaN : actions / turns;

    const bySeatCount = pooled.bySeats.map((slice) => {
      const t = sum(slice.ended.map((g) => sum(g.turnsBySeat)));
      const a = sum(
        slice.ended.map((g) => sum(g.mainActionsBySeat) + sum(g.boughtDoorActionsBySeat)),
      );
      const rounds = slice.ended.map((g) => g.rounds);
      const meanRounds =
        rounds.length === 0 ? NaN : rounds.reduce((x, y) => x + y, 0) / rounds.length;
      return `${slice.seats}p ${num(t === 0 ? NaN : a / t, 2)} over ${num(meanRounds, 1)} rounds`;
    });

    return {
      value,
      headline:
        `${num(value, 2)} actions resolved per player per turn (main action plus bought doors: ` +
        `${actions} over ${turns} turns; target ${TARGET}); ${draws} ${arm ? 'collects' : 'free Draw 1s'} ` +
        'on their own line, not counted above',
      detail: [
        `by seat count, with mean game length: ${bySeatCount.join('   ')}`,
        `the routes counted above: ${mainActions} main actions (one a turn, by rule), ` +
          `${doorActions} bought doors (${pct(turns === 0 ? NaN : doorActions / turns)} of ` +
          `turns bought one). NOT counted: ${draws} ${arm ? 'Collects (each drawing 1)' : 'free Draw 1s'} - ` +
          'reported for completeness, never folded into the action total (handoff v2 preamble).',
        '⭐ WHY 1.5 AND WHY IT IS a08 SEEN FROM THE OTHER SIDE. One main action a turn is 1.0 by ' +
          'rule; a bought door under this arm IS a visit to a rival (X5 rules out any other ' +
          'kind), so the door rate here and a08’s NEIGHBOUR-visits-per-turn rate are the same ' +
          'population. 1.0 + a08’s own 0.5 floor is 1.5, so this assertion FAILING is not a ' +
          'second finding - it is a08’s shortfall restated through the turn ledger, and the two ' +
          'should always agree. Read them together; a disagreement between them is a fold bug.',
        arm
          ? '⚠️ THE UNCAPPED TERM v31 HAD IS GONE UNDER THIS ARM AND STAYS GONE UNDER THIS ' +
            'RE-CUT. R8 deletes the turn-start meeple spend, so a meeple is only ever spent by ' +
            'visiting, which this line already counts as a bought door. There is no third route ' +
            'left to inflate the total, so the 2.5 ceiling is kept as a bug detector rather than ' +
            'a live concern: reaching it needs A Helping Hand (R11, a second bonus option) on an ' +
            'implausible share of turns, or a fold error double-counting a door.'
          : 'Under "card" the free Draw 1 is the excluded line, the same way Collect is excluded ' +
            'under the arm - the bonus slot can still buy a door (a card fee, or a self-visit) ' +
            'and that is what is counted; a Draw 1 never was a core action and re-cutting this ' +
            'assertion is what stopped it reading as one.',
        '⚠️ THIS IS A REDEFINITION, NOT A RE-DERIVATION. `actionsBySeat` in observe.ts (and the ' +
          'reading `report.ts` prints from it) is untouched and still pools the main action, ' +
          'every door, every Collect and every free Draw 1 - this assertion simply no longer ' +
          'reads that field. Expect this number to sit visibly below anything a pre-04/09/2026 ' +
          'report quoted for the same run: that is the same turns counted narrower, not a ' +
          'regression in the game.',
        '⚠️ READ THIS WITH GAME LENGTH. A high rate with a shorter game is the change working ' +
          'as designed; a high rate with an unchanged length means the extra actions went ' +
          'somewhere other than the island, which is the more worrying reading.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < TARGET || value > FAT ? 'FAIL' : 'PASS',
    };
  },
};
