import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns, totalVisits } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * Assertion 14: HOW THE BONUS SLOT WAS SPENT, five ways.
 *
 * ⚠️ RE-POINTED ON 19/08/2026, KEEPING ITS ID. It was born as ticket 56's
 * market-against-visit ratio, from the market doc's own log sheet, and its FAIL
 * condition was "market buys outnumber visits". `rules.turn.marketCost` went
 * null the same day, so that ratio became 0 by construction and the assertion
 * measured a rule nobody was playing. What it is NOT is deleted: the question
 * underneath it never moved. The bonus slot is the interaction slot, and the
 * number that decides every version of this rule set is the same one -
 * **the visit's share of bonus slots**.
 *
 * What changed is the denominator. The slot now offers four things and one way
 * to waste it, so the tally is five columns (the v30 plan, section 5.5):
 *
 *   visit-coin    a card on a rival's Notice Board, £1 from the bank
 *   visit-power   a card on the board, then their Service run
 *   own-power     £1 to run your own Service, no wage - the solitaire half
 *   upgrade       £2 to flip one of your own starters, capped at three a seat
 *   SLOT UNSPENT  turns minus bonus turns
 *
 * The first two are the hook. The verdict is read off their combined share, and
 * the split between them is diagnostic rather than judged: a table that visits
 * only for the £1 is a table whose Services are not worth renting, which is a
 * different report from a table that does not visit at all.
 *
 * ⚠️ TWO READINGS THAT WILL BE GOT WRONG IF THEY ARE NOT WRITTEN DOWN, and the
 * plan writes both down, so they are printed in the detail lines rather than
 * left to whoever reads the report:
 *
 * 1. **An upgrade spike in the opening rounds, followed by a visit-heavy
 *    midgame, is a PASS and not a fail.** The upgrade is a coin-priced
 *    solitaire option sitting in the interaction slot, which is the exact shape
 *    this project has already measured as pushing the visit rate down ("money
 *    is what buys solitaire in this game"). The difference from the market it
 *    replaced is that THIS ONE IS CAPPED - three starters, once each, then
 *    never again. A repeatable faucet-drain can crowd the visit out all game; a
 *    capped one buys an opening spike and then stops. So the upgrade share
 *    being high is only a finding if it is high LATE, which is what the early
 *    and late split below is for.
 *
 * 2. **A rising SLOT UNSPENT share is a DIFFERENT DISEASE from the market's.**
 *    The market outcompeted the visit; the start-of-turn restriction makes the
 *    visit get MISSED. A slot that is never reached for is not a slot that lost
 *    an argument, and the two want opposite fixes - the first wants the rival
 *    option priced or cut, the second wants the window widened
 *    (`overlays/bonus-any-time.overlay.json`) or a UI that asks. Reporting them
 *    in one number would hide both.
 *
 * ⚠️ THE INSTRUMENT CAVEAT ON THE UNSPENT SHARE. The bots choose one move at a
 * time from the whole legal-move list and have no concept of resolving the
 * bonus first, so a seat holding a live delivery - scored 12 to 48 by the
 * weights against a visit's 1.5 to 5 - takes the delivery and forfeits the
 * slot, where a human would spend the slot first and then deliver. The unspent
 * share is therefore biased PESSIMISTIC against real play, and the number to
 * read is the DELTA between paired arms, never the absolute. It is repeated in
 * `observe.ts` where the bucket is derived, because the two places are read by
 * different people.
 *
 * THE THRESHOLD, and what is deliberately kept OUT of it. The old rule was
 * "market must not outnumber visits" - the visit had to beat the single largest
 * rival option - and that shape survives unchanged: the visit must beat the
 * largest of own-power, upgrade and market. A restatement of the design's own
 * sentence, not a number taken from our own output, which is the bar ticket 11
 * section 2 sets.
 *
 * SLOT UNSPENT is NOT in the verdict, and that is a ruling. A forfeited slot did
 * not outcompete the visit, which is the whole of reading 2 above; and the bots
 * forfeit the slot whenever a delivery is live, so unspent is the largest column
 * by construction and would FAIL every arm including the control. An assertion
 * that can only ever fail measures nothing. It is printed first in the detail
 * lines and read as a delta between paired arms, which is the only reading it
 * can honestly carry.
 */
export const marketMix: Assertion = {
  id: 14,
  title: 'The bonus slot, five ways',
  quote:
    'The metric that decides it is not coins, it is how bonus slots were spent - if market ' +
    'outnumbers visit, the hook is losing. [19/08/2026] Re-cut it as a four-way tally - ' +
    'visit-coin / visit-power / own-power / upgrade - plus a fifth bucket the old metric never ' +
    'had and now needs: slot unspent. That fifth number is the one that answers whether the ' +
    'start-of-turn restriction is costing visits, and nothing else can.',
  source:
    'docs/card-changes-v30-implementation-plan-v5.md section 5.5; ' +
    'docs/Market Bonus Action 2026-08-03.md sections 3-4; CLAUDE.md watch-list item 0',
  shape:
    'The five-way bonus-slot tally as shares of every turn played, plus the upgrade split ' +
    'early against late and the unspent share as its own line.',
  threshold:
    'FAIL if the visit (coin + power) is outnumbered by the largest single rival OPTION - own ' +
    'Service, upgrade or market - which is the old "market outnumbers visit" rule restated over ' +
    'the new menu. SLOT UNSPENT is reported but never carries the verdict: a forfeited slot did ' +
    'not outcompete the visit, and the bots forfeit it whenever a delivery is live.',
  taste: true,
  remedy: `${NO_REMEDY} - and the remedy depends on WHICH column won. An own-power or upgrade share that beats the visit is the solitaire-in-the-slot problem, whose dials are the price of the losing option; a high UNSPENT share is the start-of-turn window, whose control is overlays/bonus-any-time.overlay.json.`,
  measure({ pooled }) {
    const games = pooled.ended;
    const turns = totalTurns(games);
    const bonusTurns = totalBonusTurns(games);

    const visits = totalVisits(games);
    const visitCoin = sum(games.map((g) => sum(g.visitCoinBySeat)));
    const visitPower = sum(games.map((g) => sum(g.visitPowerBySeat)));
    const own = sum(games.map((g) => sum(g.workOwnBySeat)));
    const upgrades = sum(games.map((g) => sum(g.upgradesBySeat)));
    const markets = sum(games.map((g) => sum(g.marketBuysBySeat)));
    // Turns minus bonus turns, and never stored anywhere: a remainder that is
    // counted separately is a remainder that can drift out of step with the
    // count it is a remainder OF.
    const unspent = Math.max(0, turns - bonusTurns);

    if (turns === 0) {
      return {
        value: NaN,
        headline: 'not measured: no turns were played',
        verdict: 'OBSERVE',
      };
    }

    const share = (n: number) => pct(n / turns);
    // The largest single OPTION that is not a visit. The market is in the list
    // rather than assumed away: it is null in the shipped rules but live under
    // overlays/turn-structure-v14.overlay.json, which is the paired control
    // this whole assertion exists to be read against.
    //
    // ⚠️ SLOT UNSPENT IS DELIBERATELY NOT IN THIS LIST, and leaving it out is a
    // ruling rather than an oversight. The design's sentence is about an option
    // OUTCOMPETING the visit - "if market outnumbers visit, the hook is losing"
    // - and a forfeited slot did not outcompete anything; the plan names it a
    // different disease in as many words. Putting it in the verdict would also
    // make the verdict permanently FAIL and therefore worthless, because the
    // bots forfeit the slot whenever a delivery is live (the caveat below), so
    // unspent is the largest column by construction and would win every arm
    // including the control. It is reported first in the detail and read as a
    // delta between arms; it is never a verdict on its own.
    const rivals: [string, number][] = [
      ['own Service', own],
      ['upgrade', upgrades],
      ['market', markets],
    ];
    const [worstName, worst] = rivals.reduce((a, b) => (b[1] > a[1] ? b : a));
    const value = visits === 0 ? (worst > 0 ? Infinity : NaN) : worst / visits;

    // The upgrade, early against late, because a capped option SHOULD spike
    // early and then stop - that shape is the PASS, and only a late upgrade
    // share is a finding. Counted off the same round series the market split
    // used, so the two are comparable across the arms.
    let upgradeEarly = 0;
    let upgradeLate = 0;
    // The plain £1 visit on a BASE Notice Board: the floor move, kept from the
    // market version of this assertion because the question it answers has
    // outlived the market. "Does the cheapest visit still get taken after the
    // midgame" is how a slot-crowding problem shows up first, whichever option
    // is doing the crowding.
    let plainEarly = 0;
    let plainLate = 0;
    for (const g of games) {
      const mid = g.rounds / 2;
      for (const round of g.upgradeRounds) {
        if (round <= mid) upgradeEarly += 1;
        else upgradeLate += 1;
      }
      for (const round of g.plainVisitRounds) {
        if (round <= mid) plainEarly += 1;
        else plainLate += 1;
      }
    }

    return {
      value,
      headline:
        `visit takes ${share(visits)} of ${turns} turns, biggest rival option ` +
        `${worstName} at ${share(worst)}; SLOT UNSPENT ${share(unspent)}`,
      detail: [
        `SLOT UNSPENT is the start-of-turn restriction, not the market's disease: the visit ` +
          `is being missed rather than outcompeted. Read it as a DELTA against ` +
          `overlays/bonus-any-time.overlay.json, never as an absolute - the bots take a live ` +
          `delivery over an unspent slot every time, which biases it pessimistic`,
        `the five-way tally, as a share of every turn played: ` +
          `visit-coin ${share(visitCoin)}, visit-power ${share(visitPower)}, ` +
          `own-power ${share(own)}, upgrade ${share(upgrades)}, ` +
          `SLOT UNSPENT ${share(unspent)}` +
          (markets > 0 ? `, market ${share(markets)}` : ''),
        `visit share of the slots that WERE spent: ` +
          `${pct(bonusTurns === 0 ? NaN : visits / bonusTurns)} of ${bonusTurns}`,
        `the upgrade, capped at three a seat: ${upgradeEarly} flips before each game's ` +
          `midgame, ${upgradeLate} after - an opening spike then nothing is the PASS shape, ` +
          `a late share is the finding`,
        `the plain £1 visit, the floor move: ${plainEarly} before each game's midgame, ` +
          `${plainLate} after`,
        `mean bonus spends per game: ${num(games.length === 0 ? NaN : bonusTurns / games.length, 1)} ` +
          `of ${num(games.length === 0 ? NaN : turns / games.length, 1)} turns`,
      ],
      verdict: value > 1 ? 'FAIL' : 'PASS',
    };
  },
};
