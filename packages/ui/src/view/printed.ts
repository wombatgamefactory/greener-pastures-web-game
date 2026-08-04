/**
 * What a card prints, derived from `cards.json` alone.
 *
 * Ticket 15 locked Fork B: text-free art with the text in the DOM. That only
 * works if the DOM card knows the same things InDesign knows, so this module
 * reproduces the sheet's `@` art columns as derivations rather than data:
 *
 *   @suit_icon   card_starter (base starter) else suit_<crop>   -> ticket 07's crop rule
 *   @vp_icon     vp.png when the face prints VP
 *   @activation  suit_<activationType> | suit_wild              -> the GROW payment
 *   @convert     action_convert (Notice Board) | action_harvest  -> what full means
 *   @cost_icon   build | caboose | game_end                     -> by card type
 *   @cost1..6    one icon per unit of buildCost                 -> crop, wild, coin
 *                (the Farmstead's bar prints its MILESTONE instead: one own-crop
 *                icon per building that flips it free - ticket 46)
 *   @cost_bar    cost_bg_<n> where n is that icon count
 *   @top_bar     ability_bg_<suit>, or bottom_bg_<suit> for Power and Endgame
 *
 * Verified against the sheet for W1/W2/W3/W4/W7/W10/W13/W18/W19/V1/O2, and
 * asserted for all 105 cards by printed.test.ts - which is what stops the web
 * card and the printed card drifting apart.
 */

import type { Card, CardFace, GameData, Suit } from '@gp/data';

export type CostIcon = { kind: 'crop'; suit: Suit } | { kind: 'wild' } | { kind: 'coin' };

export interface PrintedFace {
  readonly id: string;
  readonly suit: Suit;
  readonly upgraded: boolean;
  readonly name: string;
  readonly abilityText: string;
  /** Starters print their ability in the TOP band; Power and Endgame in the bottom one. */
  readonly bandPosition: 'top' | 'bottom';
  readonly printedVp: number;
  /** Stack slots. Null on a card that is not a stacking building (Barn, Farmstead, Power, Endgame). */
  readonly threshold: number | null;
  /** The suit a GROW payment must match; 'wild' = any card. Null when the face never activates. */
  readonly activation: Suit | 'wild' | null;
  /** What reaching the threshold is for: harvest, or the Notice Board's visitor payout. */
  readonly convert: 'harvest' | 'convert' | null;
  /** The chip on the left: the generic starting-building icon, or the crop. */
  readonly identityIcon: 'starter' | Suit;
  /** Empty when the face is not buildable (an upgraded starter is flipped, never bought). */
  readonly cost: readonly CostIcon[];
  /**
   * What the cost bar is SAYING. Everywhere but the Farmstead it is a price;
   * on the Farmstead the same slot prints the milestone that flips it free
   * (ticket 46), and the two read identically to a screen reader otherwise.
   */
  readonly costMeaning: 'price' | 'milestone';
  /** The icon at the head of the cost bar. Null when there is no cost bar. */
  readonly costIcon: 'build' | 'caboose' | 'game_end' | null;
  /** Absolute printed hand size. Barn faces only. */
  readonly handSize: number | null;
}

function faceOf(card: Card, upgraded: boolean): CardFace {
  if (card.faces) return upgraded ? card.faces.upgraded : card.faces.starter;
  return {
    name: card.name,
    printedVp: card.printedVp ?? 0,
    threshold: card.threshold ?? null,
    activationType: card.activationType ?? null,
    abilityText: card.abilityText ?? null,
  };
}

function costIcons(data: GameData, card: Card, upgraded: boolean): CostIcon[] {
  // An upgraded starter face is flipped, not bought: the £2 belongs to the base
  // face, which is the one printing the cost bar. The sheet agrees - every
  // upgraded face leaves @cost1..6 empty.
  if (upgraded) return [];
  const cost = card.buildCost;
  if (!cost) {
    // The Farmstead is the one building that is never for sale, so its bar
    // prints the MILESTONE instead of a price (ticket 46, Dean's call): one
    // own-crop icon per building of your own crop, which is what flips it free.
    // Read from the rule, never typed, so a knob and a card cannot disagree.
    if (card.slot === 'farmstead') {
      const flipAt = data.rules.economy.farmsteadFlipAtOwnColourBuilds;
      return Array.from({ length: flipAt }, () => ({ kind: 'crop', suit: card.suit }) as CostIcon);
    }
    // The Barn and the Notice Board print their £2 upgrade price there.
    const upgradeCost = card.upgradeCostCoins ?? 0;
    return Array.from({ length: upgradeCost }, () => ({ kind: 'coin' }) as CostIcon);
  }
  return [
    ...Array.from({ length: cost.suit }, () => ({ kind: 'crop', suit: card.suit }) as CostIcon),
    ...Array.from({ length: cost.wild }, () => ({ kind: 'wild' }) as CostIcon),
    ...Array.from({ length: cost.coins }, () => ({ kind: 'coin' }) as CostIcon),
  ];
}

function costIconFor(card: Card): PrintedFace['costIcon'] {
  if (card.type === 'power') return 'caboose';
  if (card.type === 'endgame') return 'game_end';
  return 'build';
}

export function printedFace(data: GameData, id: string, upgraded = false): PrintedFace {
  const card = data.cards.catalogue.find((c) => c.id === id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  const face = faceOf(card, upgraded);
  const activation = (face.activationType ?? null) as Suit | 'wild' | null;
  const cost = costIcons(data, card, upgraded);
  const isNoticeBoard = card.slot === 'noticeboard';

  return {
    id: card.id,
    suit: card.suit,
    upgraded,
    name: face.name,
    abilityText: face.abilityText ?? '',
    bandPosition: card.type === 'power' || card.type === 'endgame' ? 'bottom' : 'top',
    printedVp: face.printedVp,
    threshold: face.threshold,
    activation,
    convert: face.threshold === null ? null : isNoticeBoard ? 'convert' : 'harvest',
    // Ticket 07's rule, and the reason the £2 upgrade sinks pull double duty:
    // a base starter prints the generic icon and counts for no crop, an
    // upgraded one prints the crop.
    identityIcon: card.type === 'starter' && !upgraded ? 'starter' : card.suit,
    cost,
    costMeaning: card.slot === 'farmstead' ? 'milestone' : 'price',
    costIcon: cost.length === 0 ? null : costIconFor(card),
    handSize: face.handSize ?? null,
  };
}
