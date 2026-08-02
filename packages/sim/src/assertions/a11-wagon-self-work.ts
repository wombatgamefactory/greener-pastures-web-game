import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { pct } from '../stats.js';

/**
 * Added by ticket 06 ruling E, which read the Prosperity Wagon as printed - any
 * Hired Worker, including your own - and consciously accepted the risk it
 * creates: grow the Wagon, work your OWN Worker for a free action, mint £2, and
 * never touch the table. A hermit battery, bought with a card.
 *
 * OBSERVE, and it feeds assertion 8 rather than standing alone: a high
 * self-work share means the card pays you not to interact, which is a hook
 * problem wearing a card's clothes. Taste-sensitive, so it reports the mirror
 * spread - a hermit mirror taking it 100% of the time says nothing, and a
 * SOCIALITE mirror doing so would say a great deal.
 */
export const wagonSelfWork: Assertion = {
  id: 11,
  title: 'Prosperity Wagon self-work',
  quote:
    'The hermit-battery risk was raised and consciously accepted: growing the Wagon, working ' +
    'your own Worker for a free action and minting £2 involves no cross-table contact. It goes ' +
    'on the sim watch list.',
  source: 'ticket 06 ruling E',
  shape: "Share of Wagon activations whose Worker choice is the owner's own.",
  threshold: 'OBSERVE, taste-sensitive; feeds assertion 8',
  taste: true,
  remedy: NO_REMEDY,
  measure({ pooled }) {
    let self = 0;
    let rival = 0;
    let skips = 0;
    let activations = 0;
    for (const g of pooled.ended) {
      self += g.wagonSelfWorks;
      rival += g.wagonRivalWorks;
      skips += g.wagonSkips;
      activations += g.wagonActivations;
    }
    const total = self + rival;
    const value = total === 0 ? NaN : self / total;
    const built = pooled.cards.get('D9');
    return {
      value,
      headline:
        total === 0
          ? `no Wagon works to measure: the card was ACTIVATED ${activations} times in ` +
            `${pooled.ended.length} ended games`
          : `${pct(value)} of ${total} Wagon works target the owner's own Worker`,
      detail: [
        `${self} own, ${rival} rival, ${skips} declined, from ${activations} activations`,
        // Built-but-never-grown is a different finding from grown-and-hoarded,
        // and a bare 0% would have hidden which one this is.
        built
          ? `D9 was built in ${built.played} of the ${built.inSupply} games its deck was in play, ` +
            'so a low activation count is a GROW problem rather than a build problem'
          : 'D9 not present in this data set',
      ],
      verdict: 'OBSERVE',
    };
  },
};
