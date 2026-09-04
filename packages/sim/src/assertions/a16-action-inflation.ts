import { isMeepleCurrency } from '@gp/data';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW IN v31 (02/09/2026): ACTIONS RESOLVED PER TURN.
 *
 * ⭐ **THIS IS THE NUMBER THE WHOLE PASS MOVES, AND NOTHING MEASURED IT.** The
 * plan says so outright (risk 1) and `rules.json` repeats it in its own
 * `unresolved` list: *"actions resolved per turn is the number this entire pass
 * moves and nothing in the suite currently measures it. It has to be measured
 * BEFORE deliveriesToTrigger is dialled, or the dial will be set against an
 * unknown."*
 *
 * ## What a turn is worth now
 *
 * A v30 turn was one main action plus a bonus slot whose options were mostly
 * coin purchases - a card into a barn, a starter flipped - none of which was an
 * ACTION. A v31 turn is:
 *
 *   1 core action                      by rule, every turn
 * + 1 bonus                            a WHOLE core action for one card (the
 *                                      Wheat door is a free Harvest, the Dairy
 *                                      door a free Build), or a free Draw 1
 * + any number of meeples              free, uncapped, one at a time
 *
 * So the printed expectation is **2.0**, the floor is 1.0 (a turn that only
 * acts), and everything above 2.0 is the meeple supply - which is the part with
 * no cap on it. The meeple share is printed for exactly that reason: it is the
 * uncapped term, and it is the one that can run away.
 *
 * ## What counts, and what deliberately does not
 *
 * One count per core verb actually PERFORMED, whichever thing bought it. A card
 * effect that draws or sows inside another action is NOT counted: it is part of
 * the action that fired it, and counting it would turn "actions per turn" into
 * "things that happened per turn", which is a different and much less useful
 * number. `pass` counts nothing, because nothing was resolved.
 *
 * ## The threshold, and why it is a band and not a ceiling
 *
 * The design names the shape rather than a number - "turns are materially more
 * powerful than v30's ... expect a shorter game and higher scores" - so the
 * band is derived from the printed rule and not from a run. Below 1.5 the bonus
 * slot is being wasted on most turns and the slot is not the engine the design
 * thinks it is. Above 2.5 the meeple supply is adding a HALF EXTRA TURN to
 * every turn played, which is the runaway the risk names.
 *
 * ⚠️ READ IT WITH GAME LENGTH, ALWAYS. A high rate with a short game is the
 * change working as designed; a high rate with an UNCHANGED game length means
 * the extra actions went somewhere other than the island, and that is the more
 * worrying reading. The end trigger is the lever either way, and it must not be
 * dialled before this line has been read - which is the whole reason this
 * assertion exists.
 *
 * ## UNCHANGED IN SHAPE UNDER THE MEEPLE-LOOP ARM, AND THE MEEPLE SHARE IS NOW
 * THE VISIT SHARE BY CONSTRUCTION (04/09/2026)
 *
 * The arm does not change what an action is, how many a turn is worth, or the
 * band: one core action by rule, one bonus, and the printed expectation is still
 * 2.0. What it changes is the BOOKKEEPING of the routes, in a way that would
 * read as a collapse if it were not spelt out:
 *
 *   - **The uncapped term is gone.** R8 deletes the turn-start meeple spend, so
 *     the `via: 'meeple'` route emits nothing and its column reads a flat 0.
 *     Every meeple-bought action now arrives as a VISIT, because a visit is the
 *     only way a meeple is ever spent. The meeple share IS the visit share.
 *   - **The free Draw 1 is gone** (R9) and its action arrives attached to
 *     COLLECT instead, which is counted as one action for exactly the reason
 *     `bonusDraw` was: the slot was spent and a card came out.
 *
 * ⭐ SO THE CEILING IS LOWER AND HARDER UNDER THE ARM, and that is a real
 * difference rather than a bookkeeping one. v31 had no cap at all on actions per
 * turn: a seat could open with four meeples and spend all four before acting.
 * Here the bonus slot is one a turn by rule, one meeple goes into it, and there
 * is nothing else - so 2.0 is a CEILING and not an expectation, and anything at
 * all above it is A Helping Hand (R11) granting a second bonus option. A reading
 * materially above 2.0 under this arm is therefore not "the meeple supply ran
 * away"; it is either the Helping Hand or an engine bug, and the two are told
 * apart by whether the excess tracks that card's build rate.
 *
 * ⚠️ THE FAT BAND AT 2.5 IS KEPT RATHER THAN TIGHTENED. Tightening it to sit
 * just above a ceiling this run happens to produce would be a threshold read off
 * our own output, and the band's job is unchanged: notice a runaway. It simply
 * cannot be tripped by the mechanism it was written for.
 *
 * ⚠️ AND READ IT WITH GAME LENGTH UNDER BOTH ARMS, for the reason below - which
 * the handoff repeats as its own item 4: a high rate with a shorter game is the
 * design working, a high rate with an unchanged length is the extra actions
 * going somewhere other than the island.
 */
const THIN = 1.5;
const FAT = 2.5;

export const actionInflation: Assertion = {
  id: 16,
  title: 'Action inflation',
  quote:
    'Risk 1 - action inflation. The bonus slot now buys a full core action for one card - the ' +
    'Wheat door is a free Harvest, the Dairy door a free Build - and meeples add uncapped free ' +
    'actions on top. Turns are materially more powerful than v30s. Expect a shorter game and ' +
    'higher scores. The end trigger stays at 6 and is the first knob to sweep.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4, risk 1; ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5 (item 4, read with game ' +
    'length)',
  shape:
    'Core actions resolved per player per turn, all routes pooled - the turn action, the bonus ' +
    "slot's door or free draw, and every meeple spent - with the meeple share split out as the " +
    'uncapped term. Unchanged in shape under visitCurrency "meeple", where the turn-start ' +
    'meeple spend is deleted and the meeple share is the VISIT share by construction.',
  threshold:
    `FAIL below ${THIN} (the bonus slot is idle on most turns) or above ${FAT} (the meeple ` +
    'supply is adding half a turn to every turn). The printed expectation is 2.0: one action, ' +
    'one bonus.',
  taste: true,
  remedy:
    'npm run sim -- --watchlist --overlay=overlays/end-trigger-8.overlay.json   ' +
    `(rules.endGame.deliveriesToTrigger 8 against the shipped 6 - the only number that ` +
    'lengthens the game without changing what anything is worth). ' +
    `${NO_REMEDY} for the rate itself: the bonus slot buying a whole action IS the change, so ` +
    'the response to a high reading is the clock, not the slot.',
  measure({ data, pooled }) {
    const arm = isMeepleCurrency(data);
    const games = pooled.ended;
    const turns = sum(games.map((g) => sum(g.turnsBySeat)));
    const actions = sum(games.map((g) => sum(g.actionsBySeat)));
    const viaMeeple = sum(games.map((g) => sum(g.meepleActionsBySeat)));
    const bonusDraws = sum(games.map((g) => sum(g.bonusDrawBySeat)));
    const visits = sum(games.map((g) => sum(g.visitsBySeat)));
    const collects = sum(
      games.map((g) => sum(g.collectsWithMeeplesBySeat) + sum(g.collectsEmptyBySeat)),
    );
    const value = turns === 0 ? NaN : actions / turns;

    const bySeatCount = pooled.bySeats.map((slice) => {
      const t = sum(slice.ended.map((g) => sum(g.turnsBySeat)));
      const a = sum(slice.ended.map((g) => sum(g.actionsBySeat)));
      const rounds = slice.ended.map((g) => g.rounds);
      const meanRounds =
        rounds.length === 0 ? NaN : rounds.reduce((x, y) => x + y, 0) / rounds.length;
      return `${slice.seats}p ${num(t === 0 ? NaN : a / t, 2)} over ${num(meanRounds, 1)} rounds`;
    });

    return {
      value,
      headline:
        `${num(value, 2)} actions resolved per player per turn ` +
        `(${actions} actions over ${turns} turns; printed expectation 2.0)`,
      detail: [
        `by seat count, with mean game length: ${bySeatCount.join('   ')}`,
        arm
          ? `the routes: ${turns} turn actions by rule, ${visits} door actions bought with a ` +
            `MEEPLE on a neighbour's board, ${collects} collects (each drawing 1), ` +
            `${bonusDraws} free Draw 1s and ${viaMeeple} turn-start meeple spends - both of ` +
            'those last two are 0 by construction (R9 and R8) and a non-zero reading in either ' +
            'is an engine bug'
          : `the routes: ${turns} turn actions by rule, ${visits} door actions bought with a ` +
            `card, ${bonusDraws} free Draw 1s, ${viaMeeple} bought with a meeple ` +
            `(${pct(actions === 0 ? NaN : viaMeeple / actions)} of all actions)`,
        arm
          ? '⭐ THE MEEPLE SHARE IS THE VISIT SHARE BY CONSTRUCTION. R8 deletes the turn-start ' +
            'spend, so a meeple is only ever spent by visiting and the uncapped term of v31 ' +
            'has no route left. That makes 2.0 a CEILING here rather than an expectation - one ' +
            'action, one bonus, nothing else - so an excess is A Helping Hand (R11) or a bug, ' +
            'told apart by whether it tracks that card’s build rate. The 2.5 band is kept ' +
            'rather than tightened onto a ceiling this run happens to produce.'
          : 'The meeple share is the UNCAPPED term - the bonus slot is one a turn by rule, and ' +
            'meeples are not. It is the number to watch if this line drifts up between arms.',
        '⚠️ READ THIS WITH GAME LENGTH. A high rate with a shorter game is the change working ' +
          'as designed; a high rate with an unchanged length means the extra actions went ' +
          'somewhere other than the island, which is the more worrying reading.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < THIN || value > FAT ? 'FAIL' : 'PASS',
    };
  },
};
