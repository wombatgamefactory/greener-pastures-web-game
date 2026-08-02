/**
 * The junk rank - the reference implementation's `lowestValueHandCard`, ported.
 *
 * "Your junk is their treasure" is the design principle the whole visit stands
 * on: the fee you pay onto a neighbour's Notice Board should be the card you
 * least want, so paying it feels like taking out the bins rather than conceding.
 * A bot that pays a good card would make every visit look more expensive than
 * it is, so every profile shares this one chooser.
 *
 * The scalar is an ORDERING, not an economic estimate. It reproduces the
 * reference's tuple sort - coin-priced cards last, then by card cost, then by
 * printed VP, then by number - as one number so scoring terms can sum it.
 */

import type { GameData } from '@gp/data';
import type { CardId } from '@gp/engine';

import { cardById } from './scratch.js';

/**
 * How much a card is worth holding. Higher = keep it, lower = spend it.
 *
 * Deliberately not defensive about masked ids (`W?`): a policy that reaches one
 * has been handed information it should not have, and `cardById` throwing is
 * the loudest place for that to surface.
 */
export function cardValue(data: GameData, id: CardId): number {
  const card = cardById(data, id);
  const cost = card.buildCost;
  const coinPriced = (cost?.coins ?? 0) > 0 ? 2 : 0;
  const cards = ((cost?.suit ?? 0) + (cost?.wild ?? 0)) * 0.2;
  const vp = (card.printedVp ?? card.faces?.starter.printedVp ?? 0) * 0.1;
  // The reference's final tie-break: the printed number. Kept tiny so it only
  // ever separates cards the earlier keys tied on, and never reorders them.
  const tail = (Number(id.slice(1)) || 0) * 0.0001;
  return coinPriced + cards + vp + tail;
}

export function totalValue(data: GameData, ids: readonly CardId[]): number {
  let sum = 0;
  for (const id of ids) sum += cardValue(data, id);
  return sum;
}

/** The junkiest of a set of cards - the visit fee, the gift, the discard. */
export function lowestValueCard(data: GameData, ids: readonly CardId[]): CardId | null {
  let best: CardId | null = null;
  let bestValue = Infinity;
  for (const id of ids) {
    const value = cardValue(data, id);
    if (value < bestValue) {
      bestValue = value;
      best = id;
    }
  }
  return best;
}
