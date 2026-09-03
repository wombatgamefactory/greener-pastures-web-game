/**
 * The junk rank - the reference implementation's `lowestValueHandCard`, ported.
 *
 * "Your junk is their treasure" is the design principle the whole visit stands
 * on: the fee you pay onto a Notice Board should be the card you least want, so
 * paying it feels like taking out the bins rather than conceding. A bot that
 * paid a good card would make every visit look more expensive than it is, so
 * every profile shares this one chooser.
 *
 * The scalar is an ORDERING, not an economic estimate. It reproduces the
 * reference's tuple sort - by card cost, then by printed VP, then by number - as
 * one number so scoring terms can sum it.
 *
 * ⛔ THE COIN LEG IS GONE (v31, 02/09/2026). The first and heaviest key used to
 * be `coinPriced`: a card whose build cost printed a coin icon (the 30 Power and
 * Endgame cards, GBP 2 each) sorted above everything, worth 2 against a cost
 * key that maxes out around 0.6, so a bot would hand over any field before any
 * Power card. The rule it encoded was that a coin-priced card was unbuildable
 * until the seat had saved for it, which made it both precious and slow. v31
 * prices those same 30 cards at 2 cards of their OWN suit, so they are bought
 * with the resource everything else is bought with and the special case has
 * nothing left to be special about - and, usefully, the plain cost key now
 * ranks them above a Tier 1 anyway (2 suited cards beats 1), so the ORDER
 * barely moves even though the reason for it has gone entirely.
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
  const cache = valueCache(data);
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const card = cardById(data, id);
  const cost = card.buildCost;
  const cards = ((cost?.suit ?? 0) + (cost?.wild ?? 0)) * 0.2;
  const vp = card.printedVp * 0.1;
  // The reference's final tie-break: the printed number. Kept tiny so it only
  // ever separates cards the earlier keys tied on, and never reorders them.
  const tail = (Number(id.slice(1)) || 0) * 0.0001;
  const value = cards + vp + tail;
  cache.set(id, value);
  return value;
}

/**
 * ⭐ MEMOISED PER `GameData` (03/09/2026). The function is pure in (data, id)
 * and reads nothing that moves during a game, so the answer for a card id is
 * fixed for the whole run - but it was recomputed for every card of every
 * enumerated payment, and `Number(id.slice(1))` allocates a string each time.
 * A CPU profile put it at 1% of a whole game on its own.
 *
 * Keyed by the data object rather than globally, because a sweep arm runs an
 * OVERLAID `GameData` in the same process and an overlay may re-price a card.
 * A WeakMap, so an arm's data can be collected with its arm.
 */
const CACHES = new WeakMap<GameData, Map<CardId, number>>();

function valueCache(data: GameData): Map<CardId, number> {
  let cache = CACHES.get(data);
  if (cache === undefined) {
    cache = new Map<CardId, number>();
    CACHES.set(data, cache);
  }
  return cache;
}

export function totalValue(data: GameData, ids: readonly CardId[]): number {
  let sum = 0;
  for (const id of ids) sum += cardValue(data, id);
  return sum;
}

/** The junkiest of a set of cards - the visit fee, the gift, the sown card, the overflow discard. */
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
