/**
 * The magpie's target suit: the strongest crop at this table that is not its own.
 *
 * **Why this bot exists.** Until 2026-08-12 the Farmstead flipped free at three
 * own-crop buildings, and the bot's `buildOwnCrop` term carried the comment
 * "the Farmstead free-flip is the whole own-suit incentive". Change 14 retired
 * that flip and priced the Farmstead at £2 like its siblings, which deleted the
 * only rule tying a seat to the colour it was dealt. What survives rewards
 * CONCENTRATION in whatever crop you commit to, not loyalty:
 *
 *   - a build's suited half matches the BUILT CARD's crop (`ownSuitMin` against
 *     `c.suit`), never the builder's;
 *   - a GROW payment matches the BUILDING's crop, likewise;
 *   - the type scalers ("for each HIVE / DEPOT / ORCHARD / FIELD") count the
 *     card type, so they pay whoever built them;
 *   - a Farmstead's suit power modifies its owner's ACTIONS, not their cards,
 *     so it is worth the same whatever crop the tableau is made of.
 *
 * And two rules push the other way outright: the market may not buy your own
 * suit (Dean, 2026-08-03), and two cards score for non-Dairy / non-Apiary
 * buildings.
 *
 * So the question is whether the suit is load-bearing at all - and the reference
 * table could not ask it, because every profile inherits `buildOwnCrop: 2` and
 * the only override RAISES it (`loyalist` at 6). The 82.8% own-crop build rate
 * on reference-v9 was measured by bots told to prefer their own crop, under
 * rules that no longer pay them to. That is ticket 40's shape exactly: a weight
 * we chose manufacturing the number an assertion reports.
 *
 * ⚠️ **THE TARGET MUST BE A SEATED SUIT.** Both acquisition lanes filter to
 * `state.suitsInPlay` - the Draw at `actions.ts:1803` and the buy at `:635` - so
 * a neutral deck is unreachable even though it sits on the table with all 18 of
 * its cards. A magpie aimed at an unseated crop would have no supply at all and
 * would stall rather than play the strategy, which is why the ranking is
 * filtered by what is actually at the table instead of being a constant.
 */

import type { Suit } from '@gp/data';

/**
 * The suit ranking the magpie chases, strongest first.
 *
 * ⚠️ **A SNAPSHOT, NOT A LAW.** These are the win rates from the last full
 * reference-v9 run (2026-08-12, 180 games), taken after the Wheat, Dairy,
 * Apiary and Vegetable rebuilds and after change 14:
 *
 *     wheat 46.7%   dairy 37.4%   orchard 37.0%   apiary 32.4%   vegetable 13.1%
 *     (even share at these seat counts: 36.1%)
 *
 * Dairy, orchard and apiary sit inside each other's intervals, so their ORDER
 * here is not a measured fact - only wheat at the top and vegetable at the
 * bottom are separated. Re-read this list after any run that moves the SUITS
 * table, or the magpie is chasing last month's leader. It is deliberately a
 * hand-maintained constant rather than something read from a report: a bot that
 * read its own scoreboard would make every run depend on the previous one.
 */
export const SUIT_STRENGTH: readonly Suit[] = ['wheat', 'dairy', 'orchard', 'apiary', 'vegetable'];

/**
 * The strongest suit in play that is not `mySuit`, or null if there is no such
 * suit (a table where nothing else is seated - not reachable at 2-4 players,
 * but the terms guard on null rather than assuming).
 *
 * A wheat seat therefore chases dairy and everyone else chases wheat, so long
 * as the crop is at the table. At 2 players the choice collapses to "the other
 * seat's suit", which is the honest answer: with only two decks reachable there
 * is exactly one foreign crop to raid.
 */
export function magpieTarget(mySuit: Suit, suitsInPlay: readonly Suit[]): Suit | null {
  for (const suit of SUIT_STRENGTH) {
    if (suit !== mySuit && suitsInPlay.includes(suit)) return suit;
  }
  return null;
}
