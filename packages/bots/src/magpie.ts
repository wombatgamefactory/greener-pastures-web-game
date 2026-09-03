/**
 * The magpie's target suit: the strongest crop at this table that is not its own.
 *
 * **Why this bot existed.** Between 2026-08-12 and v31 there was NO rule tying a
 * seat to the colour it was dealt. The Farmstead's free flip at three own-crop
 * buildings had been retired, and everything left rewarded CONCENTRATION in
 * whatever crop you commit to rather than loyalty to the dealt one: a build's
 * suited half matches the BUILT CARD's crop and never the builder's, a GROW
 * payment matches the BUILDING's crop likewise, and the type scalers ("for each
 * HIVE / DEPOT / ORCHARD / FIELD") count the card type, so they pay whoever
 * built them. Meanwhile the reference table could not even ask the question,
 * because every profile inherited `buildOwnCrop: 2` and the only override RAISED
 * it. The 82.8% own-crop build rate on reference-v9 was measured by bots told to
 * prefer their own crop under rules that no longer paid them to - ticket 40's
 * shape exactly, a weight we chose manufacturing the number an assertion
 * reports.
 *
 * ⭐ **v31 ANSWERS THE QUESTION IN THE RULES, WHICH MAKES THIS BOT MORE USEFUL,
 * NOT LESS.** The Farmstead is now an end-game scorer - 1 VP for each own-crop
 * card built - and the 30 Power and Endgame cards cost 2 cards of the CARD's own
 * suit. Both point at monoculture, which is risk 3 of the whole pass and the one
 * thing the Innovation lens says the metric axis must not do. So the reference
 * bot drops its taste to 0 and prices only the rule (`farmsteadVp`), `loyalist`
 * leans past the rule, and this bot refuses the rule outright. Three seats, one
 * axis, and the spread between them is the measurement.
 *
 * ⚠️ **v31 ALSO MADE THE STRATEGY DEARER.** A magpie forfeits the Farmstead's
 * VP entirely and has to find own-suit pairs in a deck it does not farm to
 * afford any Power card. Against that it lost its single best lane - the GBP 1
 * card buy, the one acquisition in the game that was foreign BY RULE - with
 * nothing replacing it. Expect a weaker magpie than reference-v9's, and do not
 * read that weakness as a finding about the suit.
 *
 * ⚠️ **THE TARGET MUST BE A SEATED SUIT.** The Draw filters to
 * `state.suitsInPlay`, so a neutral deck is unreachable even though it sits on
 * the table with all 18 of its cards. A magpie aimed at an unseated crop would
 * have no supply at all and would stall rather than play the strategy, which is
 * why the ranking is filtered by what is actually at the table.
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
 *
 * ⚠️ **IT IS ALREADY STALE FOR v31 AND CANNOT BE FIXED YET.** Every number above
 * was measured under coins, upgraded starters, five different Farmstead suit
 * powers and per-suit Services - none of which exist - and the five suits are
 * now differentiated almost entirely by their 18 deck cards and their door. The
 * first reference-v10 run is the earliest anything can be said, and until then
 * the magpie is aiming at a ranking from a different game. That is a known
 * defect in the control, not in the target: the bot still refuses its own crop,
 * which is the half the risk-3 reading depends on.
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
