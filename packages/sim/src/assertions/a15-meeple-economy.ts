import { isMeepleCurrency } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, median, num, pct, sum } from '../stats.js';
import { tailSeries, thirdMedian } from './lib.js';

/**
 * NEW IN v31 (02/09/2026): THE MEEPLE ECONOMY - and RE-CUT ON 04/09/2026,
 * because the meeple-loop arm changes what a meeple IS.
 *
 * ## ⛔⛔ "SPENT VERSUS GAINED" IS MEANINGLESS UNDER THE ARM, AND THIS IS THE
 * SINGLE MOST IMPORTANT THING IN THIS FILE
 *
 * Under the shipped `'card'` game a meeple is claimed with an island delivery,
 * spent once for a free action, and LEAVES THE GAME. It returns to no pool. So
 * gained minus spent, over a whole game, is exactly the meeples that died in
 * somebody's supply, and the plan states the failure in one sentence: *a meeple
 * nobody spends is a dead component*. That fraction is a real fraction of a real
 * population and it is what this assertion measures under `'card'`, unchanged.
 *
 * Under `rules.turn.visitCurrency: 'meeple'` a meeple RECIRCULATES. You spend it
 * onto a neighbour's Notice Board (R1); it sits there blocking that colour; the
 * neighbour Collects it into their own supply (R7); they spend it back. One
 * physical component can be gained and spent a dozen times in a game, so the
 * denominator double-counts, the numerator double-counts, and the ratio is
 * arithmetic about a population that does not exist. **A number that says
 * nothing is worse than no number, because a reader will still read it**, so it
 * is not printed under the arm at all. What is printed instead:
 *
 *   1. **SPENDS PER MEEPLE-TURN.** Meeples spent (a wild pair counts two)
 *      divided by turns a seat BEGAN holding at least one. A turn on which a
 *      spend was possible is a population that does not move when the loop
 *      speeds up, which is exactly the property "gained" lost.
 *   2. **MEDIAN SUPPLY IN THE LAST THIRD.** Piles were the concern the cap was
 *      built to answer (R4). A supply that climbs and stays up is a wall of
 *      stored actions nobody could spend.
 *   3. **BOXED PER GAME, BY COLOUR AND BY SOURCE.** The cap's leak. Boxing on
 *      `collect` is the cap refusing the host's own payment for being visited;
 *      boxing on `island` is it refusing the island's. Those are two different
 *      arguments about whether 1 is the right cap, and pooling them loses both.
 *   4. **THE ORANGE AND CREAM SHARE OF SPENDS - the dead-colour line.** Apiary
 *      and Dairy were 10% and 13% spent under v31 against Wheat's 80%, and the
 *      cause is mechanical: Harvest, Deliver and Draw GAIN cards while Sow and
 *      Build SPEND them. **THE ARM DOES NOT FIX THAT AND WAS NEVER MEANT TO**
 *      (handoff section 8). What it adds is the wild spend (R10), which gives a
 *      dead colour a use as half an action - a patch, not the answer. This line
 *      says how much of a patch: an orange-and-cream share that is still far
 *      below two fifths says the two doors are still the two nobody can afford.
 *
 * ## The three ways this can fail, and why one number cannot see all three
 *
 * 1. **Nobody spends them.** Under `'card'` the supply climbs and the game ends
 *    with a pile; under the arm the supply cannot climb past the cap, so the
 *    same disease shows as spends per meeple-turn falling instead.
 * 2. **Some colour is dead.** The pool deals all five colours regardless of who
 *    is farming what, so a seat can hold a colour whose door it can never use.
 *    Measured per colour under both arms - it is the same question and the same
 *    counter, fed from the `visited` event under the arm because R8 deletes the
 *    `meepleSpent` one.
 * 3. **They arrive too late to spend.** Under `'card'` the end trigger is a
 *    delivery count and a delivery is the only source, so the last meeples a
 *    seat earns arrive on the turns it has fewest left; the final-round supply
 *    is printed apart from the plateau for that reason. Under the arm the
 *    island is no longer the only source (a Collect is one, and everybody starts
 *    with five, R3), so that particular artefact is much weaker - which is a
 *    prediction to check rather than an assumption to make.
 *
 * ## Where the threshold comes from, and why the arm has none
 *
 * Under `'card'` the design names no percentage but it names a SHAPE: the meeple
 * is what the island pays and it buys an action, and the tie-break was
 * deliberately written NOT to reward holding one (*"paying VP for holding one
 * would reward not spending it, which is precisely the mistake the coin pity
 * rate was deleted for"*). A component whose only use is to be spent, with no
 * reason at all to keep it, should be spent nearly always. HALF is the floor.
 *
 * ⛔ **UNDER THE ARM THAT FLOOR HAS NO REFERENT AND IS NOT REPLACED.** It was a
 * floor on a ratio that no longer exists, and the handoff names four things to
 * report without naming a number for any of them. Inventing one from this run's
 * own output is the snapshot test ticket 11 section 2 forbids, so the arm ships
 * as **OBSERVE**: measured, reported, no verdict. Say what it reads; do not say
 * whether it passes. The number that would earn a threshold is Dean's answer to
 * "how often should a held meeple be spent", and nobody has asked him.
 *
 * ⚠️ TWO BOT KNOBS SIT DIRECTLY UNDER THIS NUMBER AND NEITHER IS MEASURED.
 * `meepleGain` (2.5, pinned to `meepleSpend`) prices a meeple, and
 * `MEEPLE_LATENT` (0.4) prices one whose door is dead right now. Both were set
 * by argument, under both arms. They are the hoarding dial in the instrument,
 * not in the game - raise them and the bots hoard, lower them and they dump - so
 * sweep both before drawing any conclusion from this assertion in either
 * direction.
 */
const SPEND_FLOOR = 0.5;

/**
 * The two colours the v31 baseline found dead (Apiary 10% spent, Dairy 13%), and
 * the two whose doors SPEND cards rather than gain them. Named as suits rather
 * than as "orange and cream" in the code so the line survives a palette change.
 */
const DEAD_COLOURS = ['apiary', 'dairy'] as const;

export const meepleEconomy: Assertion = {
  id: 15,
  title: 'The meeple economy',
  quote:
    'Meeple economy - gained versus spent, and whether unspent meeples pile up. A meeple ' +
    'nobody spends is a dead component. [The tie-break] is deliberately NOT unspent meeples: a ' +
    'meeple is a stored action, so paying VP for holding one would reward not spending it. ' +
    '[04/09/2026, the meeple loop] "Spent versus gained" is MEANINGLESS once meeples ' +
    'recirculate. Report instead: spends per meeple-turn, median supply in the last third, ' +
    'boxed per game by colour, and the orange / cream share of spends.',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and section 1.5; ' +
    'packages/engine/src/runtime.ts, on the tie-break; ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5',
  shape:
    'Under visitCurrency "card": meeples spent as a share of meeples gained, the median supply ' +
    'held at each round boundary with the final round printed apart, and the spend rate per ' +
    'colour. Under "meeple": spends per meeple-turn, median supply in the last third, meeples ' +
    'boxed per game by colour and by source, and the share of spends taken by the two ' +
    'card-spending colours.',
  threshold:
    'Under "card": FAIL below half of all meeples gained ever being spent - a component with ' +
    'no reason to hold it and only one use should be spent nearly always. Under "meeple": ' +
    'OBSERVE, and deliberately so. A meeple recirculates, so the ratio that floor stood on does ' +
    'not exist; the handoff names four things to report and no number for any of them, and a ' +
    "threshold taken from this run's own output is a snapshot test that can never fail. The " +
    'floor is not replaced until Dean answers "how often should a held meeple be spent".',
  taste: true,
  remedy:
    `${NO_REMEDY} for the rule. Under either arm the two things that move this are an ` +
    'INSTRUMENT knob and a RULE knob and they must not be confused: the bots’ meepleGain / ' +
    'MEEPLE_LATENT decide how eagerly a bot spends, and rules.endGame.deliveriesToTrigger ' +
    'decides how many turns a seat has left to spend in (overlays/end-trigger-8.overlay.json). ' +
    'Under "card", overlays/meeple-pool-deep-v1.overlay.json varies the colours dealt and this ' +
    'assertion must NOT move under it - if it does, that arm changed how attractive deliveries ' +
    'are and its comparison is contaminated. Under "meeple" the two arms to sweep are ' +
    'overlays/meeple-loop-cap-two-v1.overlay.json (the cap at 2) and ' +
    'overlays/meeple-loop-no-starting-meeples-v1.overlay.json (no starting five).',
  measure(ctx) {
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/** The shipped v31 game, unchanged since 02/09/2026 and deliberately not re-derived. */
function cardGame({ pooled }: MeasureContext): Measurement {
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
      `spend rate by colour: ${spendRateByColour(games)}`,
      'A colour spent far below the others is a colour a seat cannot use: the bag deals all ' +
        'five regardless of who farms what, so a Harvest meeple in a seat with nothing full ' +
        'and a Deliver meeple in a seat with an empty barn are both legal to hold and ' +
        'impossible to spend.',
      BOT_KNOBS,
    ],
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value < SPEND_FLOOR ? 'FAIL' : 'PASS',
  };
}

/** The meeple-loop arm (04/09/2026). Four readings, no verdict - see the header. */
function meepleArm({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }

  // 1. SPENDS PER MEEPLE-TURN. Meeples out of a supply (a wild pair is two)
  //    over turns begun holding at least one, which is the population on which
  //    a spend was possible at all.
  const spends = sum(games.map((g) => sum(g.meeplesSpentBySeat)));
  const meepleTurns = sum(games.map((g) => sum(g.meepleTurnsBySeat)));
  const turns = sum(games.map((g) => sum(g.turnsBySeat)));
  const value = meepleTurns === 0 ? NaN : spends / meepleTurns;

  // 2. THE SUPPLY IN THE LAST THIRD, per game then pooled - the cap's check.
  const lastThird = median(games.map((g) => thirdMedian(g.meeplesByRound, 'last')));
  const firstThird = median(games.map((g) => thirdMedian(g.meeplesByRound, 'first')));
  const series = tailSeries(games, 5, (g) => g.meeplesByRound);

  // 3. BOXED, by source and by colour.
  const boxed = sum(games.map((g) => sum(g.meeplesBoxedBySeat)));
  const bySource = new Map<string, number>();
  const byColour = new Map<string, number>();
  for (const g of games) {
    for (const [source, n] of Object.entries(g.meeplesBoxedBySource)) {
      bySource.set(source, (bySource.get(source) ?? 0) + n);
    }
    for (const [colour, n] of Object.entries(g.meeplesBoxedByColour)) {
      byColour.set(colour, (byColour.get(colour) ?? 0) + n);
    }
  }

  // 4. THE DEAD-COLOUR LINE: orange and cream as a share of every meeple spent.
  const spentByColour = new Map<string, number>();
  for (const g of games) {
    for (const [colour, n] of Object.entries(g.meeplesSpentByColour)) {
      spentByColour.set(colour, (spentByColour.get(colour) ?? 0) + n);
    }
  }
  const totalSpent = [...spentByColour.values()].reduce((a, b) => a + b, 0);
  const dead = DEAD_COLOURS.reduce((a, colour) => a + (spentByColour.get(colour) ?? 0), 0);

  return {
    value,
    headline:
      `${num(value, 2)} meeples spent per meeple-turn (${spends} spends over ${meepleTurns} ` +
      `turns begun holding one, of ${turns} turns); median supply in the last third ` +
      `${num(lastThird, 1)}; ${num(boxed / games.length, 2)} boxed per game`,
    detail: [
      '⛔ SPENT-VERSUS-GAINED IS NOT PRINTED UNDER THIS ARM AND ITS ABSENCE IS THE POINT. A ' +
        'meeple recirculates here - spent onto a rival’s board, collected back by them, spent ' +
        'again - so one physical component is gained and spent many times and the ratio is ' +
        'arithmetic about a population that does not exist. The four lines below replace it.',
      `median supply held: ${num(firstThird, 1)} in the first third -> ${num(lastThird, 1)} in ` +
        `the last (round-boundary medians over the last five rounds: ${series
          .map((v) => num(v, 1))
          .join(' -> ')}). The cap (R4) is ceiling 1 per colour, so 5 is a full supply and a ` +
        'line that sits at the ceiling is a seat that cannot spend, not a seat that is rich.',
      `meeples BOXED by the cap: ${num(boxed / games.length, 2)} a game, ${boxed} in all. ` +
        `By source: ${[...bySource]
          .sort((a, b) => b[1] - a[1])
          .map(([source, n]) => `${source} ${n}`)
          .join('  ')}. By colour: ${[...byColour]
          .sort((a, b) => b[1] - a[1])
          .map(([colour, n]) => `${colour} ${n}`)
          .join('  ')}`,
      'Boxing on COLLECT is the cap refusing the host’s own payment for having been visited; ' +
        'boxing on ISLAND is it refusing the island’s. Two different arguments about whether 1 ' +
        'is the right cap, and pooling them loses both. A colour boxed far above the others is ' +
        'a colour the table keeps sending to a seat that already has one.',
      `⭐ THE DEAD-COLOUR LINE: ${DEAD_COLOURS.join(' and ')} take ` +
        `${pct(totalSpent === 0 ? NaN : dead / totalSpent)} of all ${totalSpent} meeples spent ` +
        `(an even share of five colours is 40%). Full split: ${[...spentByColour]
          .sort((a, b) => b[1] - a[1])
          .map(([colour, n]) => `${colour} ${pct(totalSpent === 0 ? NaN : n / totalSpent, 0)}`)
          .join('  ')}`,
      '⭐ THE COLOUR HERE IS THE MEEPLE SPENT, NOT THE DOOR BOUGHT, and the two come apart on a ' +
        'wild pair (R10), where two meeples of colours you hold buy an action of a colour you ' +
        'do not. That is deliberate and it is the whole point of the line: the dead-colour ' +
        'question is whether an orange or cream meeple ever gets USED, and half of a wild is a ' +
        'use. Assertion 7 counts the same spends under the colour BOUGHT, which is the other ' +
        'question - which action the table wanted - and the two tables will not agree.',
      '⚠️ THE ARM DOES NOT FIX THE DEAD COLOURS AND WAS NEVER MEANT TO. Sow and Build are the ' +
        'two doors that SPEND cards while Harvest, Deliver and Draw gain them, and that ' +
        'asymmetry is untouched here. What the arm adds is the wild spend (R10), which lets a ' +
        'dead colour buy half of a live action - a patch, not the answer, and the four options ' +
        'Dean declined in CLAUDE.md section 8 stay declined. This line measures the patch.',
      '⛔ NO VERDICT UNDER THIS ARM, deliberately. The "half of all meeples gained" floor was a ' +
        'floor on a ratio that no longer exists, the handoff names four things to report and a ' +
        'number for none of them, and a threshold taken from this run would be a snapshot test. ' +
        'It is not replaced until Dean answers how often a held meeple should be spent.',
      BOT_KNOBS,
    ],
    verdict: 'OBSERVE',
  };
}

function spendRateByColour(games: readonly GameMetrics[]): string {
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
  return [...colours]
    .sort((a, b) => b[1].got - a[1].got)
    .map(
      ([colour, r]) =>
        `${colour} ${pct(r.got === 0 ? NaN : r.used / r.got, 0)} (${r.used}/${r.got})`,
    )
    .join('  ');
}

const BOT_KNOBS =
  '⚠️ TWO BOT KNOBS DECIDE THIS NUMBER AND NEITHER IS MEASURED: meepleGain (2.5, pinned to ' +
  'meepleSpend) and MEEPLE_LATENT (0.4) were set by argument, not by measurement. They are the ' +
  'hoarding dial. Sweep them before concluding anything about the mechanism from this line.';
