import type { Assertion } from './types.js';
import { num, pct } from '../stats.js';

/**
 * Added by ticket 06 ruling B: the Bread Hall was marked with a cut symbol in
 * the v14 card analysis and ships as printed anyway, behind the overlay's
 * per-card `enabled` flag, "rather than cutting a card on judgement".
 *
 * INTRINSICALLY PAIRED. A single run can only report the with-it half - its own
 * share of a winning score. The delta that answers the question needs the
 * paired run, which is one of the exactly two cases ticket 11 allows a sweep
 * without a failure to justify it. The remedy field therefore carries a command
 * even though this assertion can never FAIL.
 */
export const breadHall: Assertion = {
  id: 10,
  title: 'Bread Hall on versus off',
  quote:
    'Kept as "Game end: 1VP for every £2" and implemented. Rather than cutting a card on ' +
    'judgement, the tuning overlay carries a per-card enable flag and the simulator reports the ' +
    'coin economy with it in and with it out. The cut decision then comes back with numbers.',
  source: 'ticket 06 ruling B',
  shape:
    "Paired run: delta in end-of-round table coins, and the Bread Hall's own share of a winning " +
    'score.',
  threshold: 'OBSERVE, paired - the delta is the answer, and it needs the sweep',
  taste: false,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/bread-hall-off.overlay.json   (the paired half; ' +
    'ticket 06 also notes the coin-pity sweep should run with the Bread Hall disabled for a ' +
    'clean read)',
  measure({ pooled }) {
    const t = pooled.cards.get('W21');
    let vpOfWinners = 0;
    let winnerTotals = 0;
    let games = 0;
    for (const g of pooled.ended) {
      const seat = g.winner;
      if (seat === null) continue;
      games += 1;
      winnerTotals += g.scores[seat]?.total ?? 0;
      vpOfWinners += g.cards.get('W21')?.vp[seat] ?? 0;
    }
    const share = winnerTotals === 0 ? NaN : vpOfWinners / winnerTotals;
    return {
      value: share,
      headline:
        `Bread Hall built in ${pct(t && t.held > 0 ? t.played / t.held : NaN)} of games it was ` +
        `held; ${pct(share, 2)} of the average winning score (${num(vpOfWinners / Math.max(1, games), 2)} VP a game)`,
      detail: [
        t
          ? `in supply ${t.inSupply} games, built ${t.played}, total VP contributed ${t.vp}`
          : 'W21 not present in this data set',
      ],
      verdict: 'OBSERVE',
    };
  },
};
