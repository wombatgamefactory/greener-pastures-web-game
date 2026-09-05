import type { GameData } from '@gp/data';
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
    'card-spending colours. Re-cut for handoff v2 (04/09/2026) with four more readings: meeples ' +
    'spent as a resource (R15) by use, with the priced-clog-bypass activations counted apart; ' +
    'every meeple exit by source including the two R15/R6 add; the meeple pool at the start, ' +
    'midpoint and end of the game; and the share of resource spends in the final two rounds.',
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

/**
 * ⭐⭐ THE STALE-STRING BUG, AND WHY IT MATTERED (fixed 04/09/2026, recorded in
 * `docs/meeple-loop-measurement-2026-09-04-v1.md` section 4). Before this fix,
 * `meepleArm` below printed the literal sentence "the cap (R4) is ceiling 1 per
 * colour" NO MATTER WHAT `rules.turn.meepleCapPerColour` actually was, so the
 * cap-2 and cap-3 sweep reports both said 1. It is an instrument bug and not a
 * cosmetic one: a reader comparing "5 is a full supply" against a run swept to
 * cap 3 (where a full supply is 15) would misread every number under it. Read
 * the actual knob here, once, and derive every sentence that depends on it from
 * the same variable so the two can never drift apart again.
 */
function capLine(data: GameData): { cap: number; full: number } {
  const cap = data.rules.turn.meepleCapPerColour;
  return { cap, full: cap * 5 };
}

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

/**
 * The meeple-loop arm (04/09/2026, re-cut for handoff v2 the same evening).
 * Eight readings, no verdict - see the header. Readings 1-4 are v1's original
 * four; 5-8 are R15 and the amended R6's (handoff v2 section 3, items 3, 4, 5
 * and 6) and read a flat 0 wherever `meepleAsCard` is false and `slotToll` is
 * null - the pool line (7) is the one exception, since the pool exists under
 * the shipped v1 loop already; see `meeplePoolByRound`'s own comment.
 */
function meepleArm({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const { cap, full } = capLine(data);
  const asCard = data.rules.turn.meepleAsCard === true;

  // 1. SPENDS PER MEEPLE-TURN. Meeples out of a supply (a wild pair is two)
  //    over turns begun holding at least one, which is the population on which
  //    a spend was possible at all. Unchanged in shape: a VISIT spend (R1/R7)
  //    is the only thing this ratio has ever measured, because it is the one
  //    exit that recirculates. A resource spend (R15) or a toll (R6 amended)
  //    is a DIFFERENT kind of exit - the meeple never sat in a slot waiting to
  //    be collected back - so folding either in here would inflate the
  //    denominator's own justification. They get their own reading, 5 below.
  // R17: meeples spent as a card that LANDED on a board, and how evenly the
  // table received them.
  const placed = sum(games.map((g) => sum(g.meeplesPlacedBySeat)));
  const receivedTotals = games.length === 0 ? [] : games[0]?.meeplesPlacedReceivedBySeat.map(
    (_, i) => sum(games.map((g) => g.meeplesPlacedReceivedBySeat[i] ?? 0)),
  ) ?? [];
  const receivedSpread =
    placed === 0
      ? 'n/a'
      : receivedTotals.map((n) => `${Math.round((100 * n) / placed)}%`).join(' / ');
  const visitsPerGame =
    games.length === 0 ? 0 : sum(games.map((g) => sum(g.visitsBySeat))) / games.length;
  const spends = sum(games.map((g) => sum(g.meeplesSpentBySeat)));
  const meepleTurns = sum(games.map((g) => sum(g.meepleTurnsBySeat)));
  const turns = sum(games.map((g) => sum(g.turnsBySeat)));
  const value = meepleTurns === 0 ? NaN : spends / meepleTurns;

  // 2. THE SUPPLY IN THE LAST THIRD, per game then pooled - the cap's check.
  const lastThird = median(games.map((g) => thirdMedian(g.meeplesByRound, 'last')));
  const firstThird = median(games.map((g) => thirdMedian(g.meeplesByRound, 'first')));
  const series = tailSeries(games, 5, (g) => g.meeplesByRound);

  // 3. BOXED BY THE CAP ALONE (v1-comparable: `meeplesBoxedBySeat` is filtered
  //    to `collect` / `island` / `balloon` in observe.ts precisely so this
  //    figure never moves for a reason that has nothing to do with the cap),
  //    by source and by colour.
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
  // ⭐ EVERY SOURCE, INCLUDING R15's THREE AND R6's ONE (handoff v2 section
  // 3.4). Dean asked for the cap line specifically: if the cap boxes a
  // meaningful share of this wider total, it is still doing design work under
  // the new rules; if resource spends and tolls dominate, the cap has been
  // sidelined by two new exits that were never measured against it.
  const boxedAll = sum(games.map((g) => sum(g.meeplesBoxedAllSourcesBySeat)));

  // 4. THE DEAD-COLOUR LINE: orange and cream as a share of every meeple spent.
  const spentByColour = new Map<string, number>();
  for (const g of games) {
    for (const [colour, n] of Object.entries(g.meeplesSpentByColour)) {
      spentByColour.set(colour, (spentByColour.get(colour) ?? 0) + n);
    }
  }
  const totalSpent = [...spentByColour.values()].reduce((a, b) => a + b, 0);
  const dead = DEAD_COLOURS.reduce((a, colour) => a + (spentByColour.get(colour) ?? 0), 0);

  // 5. ⭐ MEEPLES SPENT AS A RESOURCE (R15, handoff v2 section 3.3) - the new
  //    dial. `atThreshold` is the priced clog bypass: an activation a card
  //    could never have made, counted apart and as a share of EVERY meeple
  //    exit (`boxedAll`, every source pooled), which is the number the
  //    handoff asks for by name.
  const resourceSpends = sum(games.map((g) => sum(g.meepleResourceSpendsBySeat)));
  const byUse = new Map<string, number>();
  for (const g of games) {
    for (const [use, n] of Object.entries(g.meepleResourceSpendsByUse)) {
      byUse.set(use, (byUse.get(use) ?? 0) + n);
    }
  }
  const atThreshold = sum(games.map((g) => g.meepleResourceAtThresholdSpends));
  const wildResource = sum(games.map((g) => g.meepleResourceWildSpends));

  // 6. TOLL MEEPLES PAID (R6 amended). The visit share and the "does the
  //    popular farm change hands" reading belong to assertion 17; this is the
  //    boxed-by-source count's counterpart from the payer's side.
  const tollPaid = sum(games.map((g) => sum(g.tollMeeplesPaidBySeat)));
  const tollVisits = sum(games.map((g) => sum(g.tollVisitsBySeat)));

  // 7. ⭐ THE POOL, BY ROUND (handoff v2 section 3.5) - read directly off
  //    state, see `meeplePoolByRound`'s own comment for why this is exact
  //    rather than a running balance. Start / midpoint / end, and the round
  //    the pool first read zero, if it ever did.
  const poolStart = poolAt(games, () => 0);
  const poolMid = poolAt(games, (len) => Math.floor(len / 2));
  const poolEnd = poolAt(games, (len) => len - 1);
  const emptiedGames = games.filter((g) => g.poolEmptyRound !== null);
  const emptyRounds = emptiedGames.map((g) => g.poolEmptyRound as number);

  // 8. THE HOARD-AND-DUMP LINE (handoff v2 section 3.6): median supply in the
  //    last third is reading 2 above, reused; the second half is the share of
  //    resource spends (R15) that land in the final two rounds, where "final
  //    two" is relative to each game's own length so games of different
  //    lengths pool honestly.
  const finalTwoSpends = sum(
    games.map((g) => g.meepleResourceSpendRounds.filter((r) => r >= g.rounds - 1).length),
  );

  return {
    value,
    headline:
      `${num(value, 2)} meeples spent per meeple-turn (${spends} spends over ${meepleTurns} ` +
      `turns begun holding one, of ${turns} turns); median supply in the last third ` +
      `${num(lastThird, 1)}; ${num(boxed / games.length, 2)} boxed by the cap per game` +
      (asCard
        ? `; ${num(resourceSpends / games.length, 2)} spent as a resource per game (R15)`
        : ''),
    detail: [
      '⛔ SPENT-VERSUS-GAINED IS NOT PRINTED UNDER THIS ARM AND ITS ABSENCE IS THE POINT. A ' +
        'meeple recirculates here - spent onto a rival’s board, collected back by them, spent ' +
        'again - so one physical component is gained and spent many times and the ratio is ' +
        'arithmetic about a population that does not exist. The lines below replace it.',
      `median supply held: ${num(firstThird, 1)} in the first third -> ${num(lastThird, 1)} in ` +
        `the last (round-boundary medians over the last five rounds: ${series
          .map((v) => num(v, 1))
          .join(' -> ')}). The cap (R4) is ceiling ${cap} per colour, so ${full} is a full ` +
        'supply and a line that sits at the ceiling is a seat that cannot spend, not a seat ' +
        'that is rich.',
      `meeples boxed by the CAP ALONE (the v1-comparable figure): ${num(boxed / games.length, 2)} ` +
        `a game, ${boxed} in all. By source: ${[...bySource]
          .filter(([source]) => source === 'collect' || source === 'island' || source === 'balloon')
          .sort((a, b) => b[1] - a[1])
          .map(([source, n]) => `${source} ${n}`)
          .join('  ')}. By colour: ${[...byColour]
          .sort((a, b) => b[1] - a[1])
          .map(([colour, n]) => `${colour} ${n}`)
          .join('  ')}`,
      'Boxing on COLLECT is the cap refusing the host’s own payment for having been visited; ' +
        'boxing on ISLAND is it refusing the island’s. Two different arguments about whether the ' +
        'cap is set right, and pooling them loses both. A colour boxed far above the others is ' +
        'a colour the table keeps sending to a seat that already has one.',
      `⭐ EVERY SOURCE, R15 AND R6 AMENDED INCLUDED (handoff v2 section 3.4): ${num(boxedAll / games.length, 2)} ` +
        `meeples a game leave the game by ANY route, ${boxedAll} in all - ${boxedAll - boxed} more ` +
        `than the cap alone under this run. Full split: ${[...bySource]
          .sort((a, b) => b[1] - a[1])
          .map(([source, n]) => `${source} ${n} (${pct(boxedAll === 0 ? NaN : n / boxedAll)})`)
          .join('  ')}. Boxing on BUILD / ACTIVATION / DELIVERY is R15 succeeding - the meeple ` +
        'bought something and was spent exactly as a card would have been; boxing on TOLL is the ' +
        'amended R6 succeeding as a sink. Neither is the cap doing work and neither should be ' +
        'read as evidence about R4.',
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
      asCard
        ? `⭐ MEEPLES SPENT AS A RESOURCE (R15, handoff v2 section 3.3): ${resourceSpends} over ` +
          `${games.length} games (${num(resourceSpends / games.length, 2)} a game). By use: ` +
          `${[...byUse]
            .sort((a, b) => b[1] - a[1])
            .map(
              ([use, n]) => `${use} ${n} (${pct(resourceSpends === 0 ? NaN : n / resourceSpends)})`,
            )
            .join('  ')}. Of those, ${atThreshold} ` +
          `(${pct(resourceSpends === 0 ? NaN : atThreshold / resourceSpends)} of resource ` +
          'spends) fired a building ALREADY AT ITS THRESHOLD - the priced clog bypass, and the ' +
          `one exit a card could never have made. As a share of EVERY meeple that left the game ` +
          `by any route: ${pct(boxedAll === 0 ? NaN : atThreshold / boxedAll)}. ` +
          `${wildResource} of the ${resourceSpends} resource-spend meeples were half of a WILD ` +
          `PAIR (${num(wildResource / 2, 1)} pairs, ` +
          `${pct(resourceSpends === 0 ? NaN : wildResource / resourceSpends)}) - R10 reused ` +
          'rather than re-rated: this is the same wild spend assertion 7 and 8 already count, ' +
          'landing here because it paid a build, an activation or a crate instead of a door.'
        : '⭐ MEEPLES SPENT AS A RESOURCE (R15): 0, by construction - `rules.turn.meepleAsCard` ' +
          'is false under this run, so a meeple only ever buys its colour\'s action and every ' +
          'number in this block is the shipped v1 loop unchanged.',
      asCard
        ? `⭐ TOLL MEEPLES PAID (R6 amended): ${tollPaid} over ${tollVisits} visits that paid a ` +
          `nonzero toll (mean ${num(tollVisits === 0 ? NaN : tollPaid / tollVisits, 2)} per toll ` +
          'visit). Assertion 17 owns the visit-share and the "does the popular farm change ' +
          'hands" reading; this is the same meeples counted from the payer\'s side, and they ' +
          'also appear above under `meeplesBoxedBySource.toll`.'
        : '⭐ TOLL MEEPLES PAID (R6 amended): 0, by construction - `rules.turn.slotToll` is null ' +
          'under this run, so an occupied slot still refuses that colour outright (v1) rather ' +
          'than pricing it.',
      // ⭐ R17's OWN LINE (Dean, 05/09/2026): a meeple spent as a card now LANDS
      // on a neighbour's board instead of leaving the game. It is the whole of
      // the change and it needs its own reading, because `meepleAsCard` counts
      // the same meeples under v2's box rule and the two arms are otherwise
      // indistinguishable in that field.
      placed > 0
        ? `⭐ MEEPLES PLACED AS PAYMENT (R17): ${placed} over ${games.length} games ` +
          `(${num(placed / games.length, 2)} a game), against ${num(visitsPerGame, 2)} rival ` +
          'visits a game. THIS IS THE RATIO THE CHANGE EXISTS TO MOVE: under v2 the same ' +
          'meeples went to the box, so the resource use drained the pool instead of feeding ' +
          'it. The receiving spread across seats is ' +
          `${receivedSpread}, which says whether payments feed the table evenly or one farm. ` +
          '⚠️ A PLACEMENT IS NOT A VISIT and is counted nowhere near the hook: it buys the ' +
          'payer no door and spends no bonus slot.'
        : '⭐ MEEPLES PLACED AS PAYMENT (R17): 0, by construction - ' +
          "`rules.turn.meepleAsCardGoesTo` is 'box' under this run, so a meeple spent as a " +
          'card leaves the game exactly as handoff v2 had it.',
      `⭐ THE POOL, BY ROUND (handoff v2 section 3.5): every meeple in a supply, on a Notice ` +
        `Board slot, or still on an undelivered island space, summed. ${num(poolStart, 1)} at ` +
        `the start -> ${num(poolMid, 1)} at the midpoint -> ${num(poolEnd, 1)} at the end. ` +
        `${emptiedGames.length} of ${games.length} games ` +
        `(${pct(games.length === 0 ? NaN : emptiedGames.length / games.length)}) saw the pool ` +
        'hit zero at least once' +
        (emptyRounds.length > 0 ? `, at round ${num(median(emptyRounds), 1)} (median)` : '') +
        '. A pool that empties by midgame is the coin drought again (v1 measurement doc section ' +
        '4): R15 and the amended R6 open two new drains without adding a new faucet, so a ' +
        'falling pool is the design working as intended and an EMPTIED one this early is the ' +
        'drought repeating itself.',
      `⭐ THE HOARD-AND-DUMP LINE (handoff v2 section 3.6): median supply in the last third is ` +
        `the reading above (${num(lastThird, 1)}); of ${resourceSpends} meeple-as-resource ` +
        `spends, ${finalTwoSpends} (${pct(resourceSpends === 0 ? NaN : finalTwoSpends / resourceSpends)}) ` +
        'fell in the final two rounds of their own game. Dean: no limit until this says there ' +
        'is a problem - an even higher-than-even share here is not itself a fault, only a ' +
        'reading to watch if a cap or a limit is ever proposed against it.',
      '⛔ NO VERDICT UNDER THIS ARM, deliberately. The "half of all meeples gained" floor was a ' +
        'floor on a ratio that no longer exists, the handoff names things to report and no ' +
        'number for any of them, and a threshold taken from this run would be a snapshot test. ' +
        'It is not replaced until Dean answers how often a held meeple should be spent.',
      BOT_KNOBS,
    ],
    verdict: 'OBSERVE',
  };
}

/** The pool at a chosen position in each game's `meeplePoolByRound` series, median across games. */
function poolAt(games: readonly GameMetrics[], at: (len: number) => number): number {
  const vals: number[] = [];
  for (const g of games) {
    const series = g.meeplePoolByRound;
    if (series.length === 0) continue;
    const v = series[at(series.length)];
    if (v !== undefined) vals.push(v);
  }
  return median(vals);
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
