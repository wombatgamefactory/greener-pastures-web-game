import type { Assertion } from './types.js';
import { NO_REMEDY, unmeasured } from './types.js';
import { totalVisits } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * Ticket 56, from the market doc's own log sheet (its section 4): the bonus
 * slot is the interaction slot and it now contains a solitaire option, so the
 * number that decides the rule is not coins - it is how bonus slots were spent.
 *
 * The doc names the FAIL condition in as many words, which is what earns this a
 * verdict rather than an OBSERVE. The details carry the rest of the log sheet:
 * the mix itself, the plain £1 visit after midgame (the floor move the market
 * eats first), and the exploit probe (island slots that could have been bought
 * entirely at market with no harvest between, especially by Vegetable seats).
 * The probe used to split by island level, where a Level 3 slot was the big
 * prize; the flat island prices every tile the same, so it is one count.
 *
 * Reports OBSERVE while `rules.turn.marketCost` is null: with no market in the
 * game the ratio is 0 by construction, and printing that as a PASS would dress
 * an absent rule up as a healthy one.
 */
export const marketMix: Assertion = {
  id: 14,
  title: 'The market against the visit',
  quote:
    'The metric that decides it is not coins, it is how bonus slots were spent - if market ' +
    'outnumbers visit, the hook is losing. The option it eats first is the plain £1 visit - ' +
    'check that still gets taken after the midgame.',
  source: 'docs/Market Bonus Action 2026-08-03.md sections 3-4, CLAUDE.md watch-list item 0',
  shape: 'Market buys per visit, pooled; the mix per bonus slot; the exploit probe as counts.',
  threshold: 'FAIL if market buys outnumber visits (ratio above 1)',
  taste: true,
  remedy: `${NO_REMEDY} - the doc's dials are the price (£4 fallback) or deleting the rule.`,
  measure({ data, pooled }) {
    if (data.rules.turn.marketCost === null) {
      return unmeasured('the market is switched off (rules.turn.marketCost is null)');
    }
    const games = pooled.ended;
    const visits = totalVisits(games);
    const markets = sum(games.map((g) => sum(g.marketBuysBySeat)));
    const own = sum(games.map((g) => sum(g.workOwnBySeat)));
    const slots = visits + markets + own;
    const value = visits === 0 ? (markets > 0 ? Infinity : NaN) : markets / visits;

    // The plain £1 visit, before and after the midgame. A game's midpoint is
    // its own rounds/2; pooled as raw counts because the doc asks "does it
    // still get taken", not "at what rate".
    let plainEarly = 0;
    let plainLate = 0;
    for (const g of games) {
      const mid = g.rounds / 2;
      for (const round of g.plainVisitRounds) {
        if (round <= mid) plainEarly += 1;
        else plainLate += 1;
      }
    }

    const funded = sum(games.map((g) => g.marketFundedDeliveries));
    const fundedVeg = sum(games.map((g) => g.marketFundedVeg));

    return {
      value,
      headline: `${num(value, 2)} market buys per visit (${markets} market, ${visits} visits, ${own} own-Worker)`,
      detail: [
        `bonus-slot mix: ${pct(slots === 0 ? NaN : visits / slots)} visit, ` +
          `${pct(slots === 0 ? NaN : markets / slots)} market, ` +
          `${pct(slots === 0 ? NaN : own / slots)} own Worker (${slots} slots spent)`,
        `market buys per ended game: ${num(games.length === 0 ? NaN : markets / games.length, 1)}`,
        `the plain £1 visit: ${plainEarly} before each game's midgame, ${plainLate} after`,
        `exploit probe - deliveries coverable by market buys alone since the last harvest: ` +
          `${funded} (of which ${fundedVeg} by a Vegetable seat)`,
      ],
      verdict: !Number.isFinite(value) && markets === 0 ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
    };
  },
};
