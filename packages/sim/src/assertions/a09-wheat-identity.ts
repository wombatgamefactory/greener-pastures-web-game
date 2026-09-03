import type { Suit } from '@gp/data';
import { SUITS } from '@gp/data';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, median, num, pct } from '../stats.js';

/**
 * Added by ticket 06. Wheat ships as printed rather than being redesigned, on
 * the explicit grounds that the sim should make the case rather than judgement,
 * so this is OBSERVE by construction: there is no number in the design to fail
 * against, only a question to answer with evidence.
 *
 * ⛔ RE-POINTED FOR v31 (02/09/2026). The first reading used to be WAGE INCOME -
 * coins the bank minted to a Wheat seat off rivals' Worker uses - which was the
 * direct measure of "does hosting pay". There is no wage. What a host gets from
 * a visit now is a CARD on their board, which they harvest into their own barn,
 * so the question "is Wheat's hosting identity vestigial" is answered by the
 * traffic its door takes and the freight that traffic leaves behind.
 *
 * That re-point makes the question sharper rather than blunter, because the
 * Wheat door is a free HARVEST - and a harvest is exactly what clears the very
 * board the visitor just filled. A suit whose door hands a visitor the action
 * that unclogs the host is a strange shape, and this is where it shows up.
 *
 * Two readings, because "hosting" could be vestigial in two different ways.
 * Traffic and freight are whether being visited is worth anything; play rate is
 * whether anyone wants the suit's cards at all.
 */
export const wheatIdentity: Assertion = {
  id: 9,
  title: "Wheat's cross-table identity",
  quote:
    "Wheat's hosting identity may be vestigial. With the Notice Board as the only visit target, " +
    "Wheat's low thresholds no longer pull traffic. Re-examine what Wheat's cross-table " +
    'identity is for. [02/09/2026] There is no wage, so what a host gets is the freight a ' +
    'visitor leaves on their board - and the Wheat door is the free Harvest that clears it.',
  source: 'docs/Unified Visit v14.md section 7.6, re-pointed onto freight for v31',
  shape:
    "Freight a Wheat seat received from rivals per game against the set median; Wheat's mean " +
    'card play rate against the band of the other four suits.',
  threshold: 'OBSERVE - the design names no number, so this reports and does not judge',
  taste: false,
  remedy: NO_REMEDY,
  measure({ data, pooled }) {
    const freightBySuit = new Map<Suit, number[]>(SUITS.map((s) => [s, []]));
    for (const g of pooled.ended) {
      g.suits.forEach((suit, seat) => {
        freightBySuit.get(suit)?.push(g.freight.receivedBySeat[seat] ?? 0);
      });
    }
    const wageMeans = new Map([...freightBySuit].map(([s, xs]) => [s, mean(xs)]));
    const setMedian = median([...wageMeans.values()].filter(Number.isFinite));
    const wheatWage = wageMeans.get('wheat') ?? NaN;

    const playBySuit = new Map<Suit, number[]>(SUITS.map((s) => [s, []]));
    for (const card of data.cards.catalogue) {
      if (!card.inDeck) continue;
      const t = pooled.cards.get(card.id);
      if (!t || t.held === 0) continue;
      playBySuit.get(card.suit)?.push(t.played / t.held);
    }
    const playMeans = new Map([...playBySuit].map(([s, xs]) => [s, mean(xs)]));
    const others = SUITS.filter((s) => s !== 'wheat')
      .map((s) => playMeans.get(s) ?? NaN)
      .filter(Number.isFinite);
    const wheatPlay = playMeans.get('wheat') ?? NaN;

    return {
      value: Number.isFinite(setMedian) && setMedian > 0 ? wheatWage / setMedian : NaN,
      headline:
        `Wheat receives ${num(wheatWage, 2)} fees a game from rivals against a set median of ` +
        `${num(setMedian, 2)}; play rate ${pct(wheatPlay)} against a band of ` +
        `${pct(Math.min(...others))}-${pct(Math.max(...others))}`,
      detail: [
        `freight received by suit: ${[...wageMeans].map(([s, v]) => `${s} ${num(v, 2)}`).join('  ')}`,
        `mean card play rate by suit: ${[...playMeans]
          .map(([s, v]) => `${s} ${pct(v)}`)
          .join('  ')}`,
      ],
      verdict: 'OBSERVE',
    };
  },
};
