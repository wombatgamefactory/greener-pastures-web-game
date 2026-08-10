import type { Assertion } from './types.js';
import { NO_REMEDY, unmeasured } from './types.js';
import { mean, pct } from '../stats.js';

/**
 * REPLACED THE PROSPERITY WAGON SELF-WORK PROBE (the Dairy rebuild,
 * 2026-08-10). That assertion measured the hermit battery - grow D9, work your
 * OWN Worker for a free action, mint £2, never touch the table - and the clause
 * it watched no longer exists: the Hiring Fair is gone and the Wagon is a
 * scaling build discount now. An assertion whose mechanism has been deleted
 * cannot fail, so it is replaced rather than left to report 0 for ever.
 *
 * What takes its place is the rebuilt suit's own headline risk, and the design
 * document names it as risk 1 in so many words: the whole of Dairy's Tier 1 and
 * Tier 2 - nine cards - is CONDITIONAL ON WANTING TO BUILD. That is the price of
 * the identity and the right price, but it is the screen most likely to fail at
 * a table, and this is the number that says whether it does. The three Tier 3
 * ACTION cards are deliberately immune to it, which is the main structural gain
 * in v4; if this line is high AND the Tier 3 play rate is low, the suit is
 * simply idle.
 *
 * OBSERVE: the design names no threshold, and setting one from our own first run
 * would be a snapshot test that can never fail. What is reported beside it is the
 * TABLE's rate, because a Dairy seat idling at the same rate as everyone else is
 * a game-wide draw problem and not a suit one - and the two send a change in
 * opposite directions.
 */
export const dairyNoBuild: Assertion = {
  id: 11,
  title: 'Dairy turns with no build available',
  quote:
    'The whole suit is conditional on wanting to build, at Tiers 1 and 2. That is the price of ' +
    'the identity and it is the right price, but it is the screen most likely to fail at a ' +
    'table. Measure the share of Dairy turns with no build available.',
  source: 'docs/dairy-suit-rebuild-v4.md, risk 1',
  shape: 'Share of turns a Dairy seat began with no legal Build, against the table.',
  threshold: 'OBSERVE; read beside the Tier 3 play rate',
  taste: true,
  remedy: NO_REMEDY,
  measure({ pooled }) {
    let dairyBlocked = 0;
    let dairySampled = 0;
    let otherBlocked = 0;
    let otherSampled = 0;
    const buildsPerDairySeat: number[] = [];

    for (const g of pooled.ended) {
      g.suits.forEach((suit, seat) => {
        const blocked = g.noBuildTurnsBySeat[seat] ?? 0;
        const sampled = g.buildSampledBySeat[seat] ?? 0;
        if (suit === 'dairy') {
          dairyBlocked += blocked;
          dairySampled += sampled;
          buildsPerDairySeat.push(g.buildsBySeat[seat] ?? 0);
        } else {
          otherBlocked += blocked;
          otherSampled += sampled;
        }
      });
    }

    if (dairySampled === 0) return unmeasured('no Dairy seat in this data set');
    const value = dairyBlocked / dairySampled;
    const table = otherSampled === 0 ? NaN : otherBlocked / otherSampled;
    return {
      value,
      headline:
        `${pct(value)} of ${dairySampled} Dairy turns began with no legal Build ` +
        `(the other suits: ${pct(table)})`,
      detail: [
        `builds per Dairy seat per game: ${mean(buildsPerDairySeat).toFixed(2)}`,
        'Nine of the suit’s cards do nothing on a turn counted here. Read it against the Tier 3 ' +
          'play rate: the ACTION cards are immune to this by design, so a high share here with a ' +
          'low share there is the suit idling rather than the screen biting.',
      ],
      verdict: 'OBSERVE',
    };
  },
};
