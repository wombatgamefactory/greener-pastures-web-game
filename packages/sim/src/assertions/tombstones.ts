/**
 * THE RETIRED ASSERTIONS, and why each one stopped being answerable.
 *
 * Ticket 11's rule was that an assertion cites design intent and never our own
 * output. The corollary nobody wrote down until v31 is what to do when the
 * intent itself is deleted: an assertion whose subject no longer exists cannot
 * FAIL, so leaving it in the suite means printing a permanent PASS that reads
 * as evidence and is not. Deleting the file loses the reasoning, which is the
 * expensive half.
 *
 * So the measurement goes and the reasoning stays here, dated, with the number
 * it last read. The report prints this list under the watch list, short, so a
 * reader who remembers assertion 1 can see what happened to it rather than
 * assume it was quietly dropped.
 */

export interface Tombstone {
  /** The id it held in the suite. Ids are never reused. */
  readonly id: number;
  readonly title: string;
  readonly retired: string;
  /** What it measured, what it last read, and why the subject is gone. */
  readonly why: string;
}

export const RETIRED: readonly Tombstone[] = [
  {
    id: 1,
    title: 'Coin flood',
    retired: '02/09/2026 (v31)',
    why:
      'Measured the mean absolute change in the median end-of-round coin pile over the last ' +
      'five rounds, excluding the final round, and FAILED above GBP 1 a step - one whole turn ' +
      "of minting banked and never spent, taken from v14's own arithmetic. Last read on " +
      'reference-v9: FAIL at GBP 1.25 a step, the climb sitting across seat counts (GBP 1.0 / ' +
      'GBP 1.0 / GBP 3.5 entering the final round) rather than within a game. THE SUBJECT IS ' +
      'GONE: v31 deletes the currency outright. Two of its findings are worth carrying anyway, ' +
      'because they are about faucets and not about coins - a metric measured as a percentage ' +
      'runs backwards against a falling level (which is why the meeple economy is counted, not ' +
      'ratioed), and the last round always spikes because the end-trigger reward lands with no ' +
      'turns left to spend it (which is why the meeple series excludes it too).',
  },
  {
    id: 3,
    title: 'Bootstrap',
    retired: '02/09/2026 (v31)',
    why:
      'Measured the turn on which a seat first activated its OWN Service, and FAILED if fewer ' +
      'than half of seats ever did. It existed because a seat started on GBP 0 and its own ' +
      'Service cost GBP 1, so the money to run your own farm had to come from a neighbour ' +
      'first - the hook stated as an arithmetic. Last read on reference-v9: PASS, median turn ' +
      '8.0, 89.6% of seats. THE SUBJECT IS GONE: there is no owner activation cost, because ' +
      'there is no cost. The owner now places a card on their own board exactly as a rival ' +
      'does, and that is a SELF-VISIT - which is not a bootstrap to be measured but a risk to ' +
      'be watched, and a17-bonus-mix and a08-the-hook own it between them.',
  },
  {
    id: 10,
    title: 'Bread Hall on versus off',
    retired: '02/09/2026 (v31)',
    why:
      'An intrinsically paired OBSERVE, added by ticket 06 ruling B so that a card marked for ' +
      'the cut in the v14 analysis could be judged on numbers rather than on taste. W21 The ' +
      'Bread Hall scored "1 VP for every GBP 2" and was the last coin-to-VP route in the game ' +
      'after the pity rate was deleted on 2026-08-03, which is what made it worth its own ' +
      'assertion: it rewarded HOARDING against every sink the design had. THE SUBJECT IS GONE ' +
      'twice over - there are no coins to hoard, and the card was retexted with the other ten ' +
      'coin cards. The general lesson survives and is worth keeping: a scoring card that pays ' +
      'for not spending will beat every sink you build.',
  },
  {
    id: 14,
    title: 'The bonus slot, five ways',
    retired: '02/09/2026 (v31), and immediately replaced by assertion 17',
    why:
      "Born as ticket 56's market-against-visit ratio and re-pointed on 19/08/2026 into a " +
      'five-way tally: visit-coin / visit-power / own-power / upgrade / SLOT UNSPENT. Four of ' +
      'those five columns named a currency and all four are gone - there is one visit with one ' +
      'payoff, no Service to run for GBP 1 and no second faces to buy. THE QUESTION UNDERNEATH ' +
      'IT NEVER MOVED and is now a17-bonus-mix: the bonus slot is the interaction slot, and the ' +
      "number that decides every version of this rule set is the visit's share of it. Two of " +
      'its rulings are carried into 17 verbatim, because both were hard-won. SLOT UNSPENT never ' +
      'carries a verdict - a forfeited slot did not outcompete anything, and the bots forfeit ' +
      'it whenever a big action is live, so it would fail every arm including the control. And ' +
      'a capped option that spikes early and then stops is a PASS shape, which is why the ' +
      'early/late split exists at all.',
  },
];
