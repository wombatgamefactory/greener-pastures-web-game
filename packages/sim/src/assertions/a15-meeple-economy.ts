import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, num, pct, sum } from '../stats.js';
import { tailSeries } from './lib.js';

/**
 * NEW IN v31 (02/09/2026): THE MEEPLE ECONOMY - gained against spent, and
 * whether the unspent pile grows.
 *
 * A meeple is claimed with an island delivery, sits face up in front of its
 * owner, and is spent at the start of a later turn to perform its colour's
 * plain door action free, after which it LEAVES THE GAME. It returns to no
 * pool. So gained minus spent, over a whole game, is EXACTLY the meeples that
 * died in somebody's supply, and the plan states the failure in one sentence:
 * *a meeple nobody spends is a dead component*.
 *
 * ## The three ways this can fail, and why one number cannot see all three
 *
 * 1. **Nobody spends them.** The supply climbs and the game ends with a pile.
 *    Measured as the SPEND RATE (spent / gained) and, as its twin, the median
 *    supply held at each round boundary.
 * 2. **Some colour is dead.** The pool deals all five colours regardless of who
 *    is farming what, so a seat can hold a colour whose door it can never use.
 *    Measured per colour - a colour spent far below its share of the deal is a
 *    colour that is decoration.
 * 3. **They arrive too late to spend.** The end trigger is a delivery count,
 *    and a delivery is the only source, so the last meeples a seat earns arrive
 *    on the turns it has fewest left. The final-round supply is printed apart
 *    from the plateau for that reason - it is the shape of the ending, not the
 *    health of the economy, and pooling the two would let a structural artefact
 *    masquerade as hoarding. (That distinction is inherited whole from the
 *    retired coin-flood assertion, which learnt it the expensive way.)
 *
 * ## Where the threshold comes from
 *
 * The design names no percentage, so this is not a number lifted off a run. The
 * design names a SHAPE: the meeple is what the island pays and it buys an
 * action, and the tie-break was deliberately written NOT to reward holding one
 * (*"paying VP for holding one would reward not spending it, which is precisely
 * the mistake the coin pity rate was deleted for"*). A component whose only
 * use is to be spent, with no reason at all to keep it, should be spent nearly
 * always. HALF is the floor: below it, most of what the island pays out never
 * becomes an action, and the reward is a token rather than a mechanism.
 *
 * ⚠️ TWO BOT KNOBS SIT DIRECTLY UNDER THIS NUMBER AND NEITHER IS MEASURED.
 * `meepleGain` (2.5, pinned to `meepleSpend`) prices a meeple, and
 * `MEEPLE_LATENT` (0.4) prices one whose door is dead right now. Both were set
 * by argument. They are the hoarding dial in the instrument, not in the game -
 * raise them and the bots hoard, lower them and they dump - so sweep both
 * before drawing any conclusion from this assertion in either direction.
 */
const SPEND_FLOOR = 0.5;

export const meepleEconomy: Assertion = {
  id: 15,
  title: 'The meeple economy',
  quote:
    'Meeple economy - gained versus spent, and whether unspent meeples pile up. A meeple ' +
    'nobody spends is a dead component. [The tie-break] is deliberately NOT unspent meeples: a ' +
    'meeple is a stored action, so paying VP for holding one would reward not spending it.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and section 1.5; ' +
    'packages/engine/src/runtime.ts, on the tie-break',
  shape:
    'Meeples spent as a share of meeples gained; the median supply held at each round ' +
    'boundary, with the final round printed apart; and the spend rate per colour.',
  threshold:
    'FAIL below half of all meeples gained ever being spent - a component with no reason to ' +
    'hold it and only one use should be spent nearly always',
  taste: true,
  remedy:
    `${NO_REMEDY} for the rule. The two things that move this are an INSTRUMENT knob and a ` +
    'RULE knob and they must not be confused: the bots’ meepleGain / MEEPLE_LATENT decide how ' +
    'eagerly a bot spends, and rules.endGame.deliveriesToTrigger decides how many turns a seat ' +
    'has left to spend in (overlays/end-trigger-8.overlay.json). ' +
    'overlays/meeple-pool-deep-v1.overlay.json varies the colours dealt, and this assertion ' +
    'must NOT move under it - if it does, that arm changed how attractive deliveries are and ' +
    'its comparison is contaminated.',
  measure({ pooled }) {
    const games = pooled.ended;
    const gained = sum(games.map((g) => sum(g.meeplesGainedBySeat)));
    const spent = sum(games.map((g) => sum(g.meeplesSpentBySeat)));
    const unspent = sum(games.map((g) => sum(g.meeplesUnspentBySeat)));
    const value = gained === 0 ? NaN : spent / gained;

    // The plateau, read the way the retired coin assertion read its own: the
    // last five round boundaries, with the FINAL one excluded and printed
    // separately, because the end trigger pays out with no turns left to spend.
    const series = tailSeries(games, 5, (g) => g.meeplesByRound);
    const plateau = series.slice(0, -1);
    const last = series[series.length - 1];

    const colours = new Map<string, { got: number; used: number }>();
    for (const g of games) {
      for (const [colour, n] of Object.entries(g.meeplesGainedByColour)) {
        const row = colours.get(colour) ?? { got: 0, used: 0 };
        row.got += n;
        colours.set(colour, row);
      }
      for (const [colour, n] of Object.entries(g.meeplesSpentByColour)) {
        const row = colours.get(colour) ?? { got: 0, used: 0 };
        row.used += n;
        colours.set(colour, row);
      }
    }

    return {
      value,
      headline:
        `${pct(value)} of meeples gained are spent (${spent} of ${gained} over ` +
        `${games.length} games); ${num(
          games.length === 0 ? NaN : unspent / games.length,
          2,
        )} die unspent per game`,
      detail: [
        `meeples per seat per game: ${num(
          mean(games.flatMap((g) => g.meeplesGainedBySeat.slice(0, g.seats))),
          2,
        )} gained, ${num(
          mean(games.flatMap((g) => g.meeplesSpentBySeat.slice(0, g.seats))),
          2,
        )} spent`,
        `median supply held over the last rounds: ${plateau
          .map((v) => num(v, 1))
          .join(' -> ')}   (final round ${num(last ?? NaN, 1)}, printed apart - the end ` +
          'trigger pays out with no turns left to spend, which is the shape of the ending and ' +
          'not the health of the economy)',
        `spend rate by colour: ${[...colours]
          .sort((a, b) => b[1].got - a[1].got)
          .map(
            ([colour, r]) =>
              `${colour} ${pct(r.got === 0 ? NaN : r.used / r.got, 0)} (${r.used}/${r.got})`,
          )
          .join('  ')}`,
        'A colour spent far below the others is a colour a seat cannot use: the bag deals all ' +
          'five regardless of who farms what, so a Harvest meeple in a seat with nothing full ' +
          'and a Deliver meeple in a seat with an empty barn are both legal to hold and ' +
          'impossible to spend.',
        '⚠️ TWO BOT KNOBS DECIDE THIS NUMBER AND NEITHER IS MEASURED: meepleGain (2.5, pinned ' +
          'to meepleSpend) and MEEPLE_LATENT (0.4) were set by argument, not by measurement. ' +
          'They are the hoarding dial. Sweep them before concluding anything about the ' +
          'mechanism from this line.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < SPEND_FLOOR ? 'FAIL' : 'PASS',
    };
  },
};
