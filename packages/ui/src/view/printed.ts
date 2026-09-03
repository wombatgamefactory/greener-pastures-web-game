/**
 * What a card prints, derived from `cards.json` alone.
 *
 * Ticket 15 locked Fork B: text-free art with the text in the DOM. That only
 * works if the DOM card knows the same things InDesign knows, so this module
 * reproduces the sheet's `@` art columns as derivations rather than data:
 *
 *   @suit_icon   card_starter (starter) else suit_<crop>       -> ticket 07's crop rule
 *   @vp_icon     vp.png when the face prints VP
 *   @activation  suit_<activationType> | suit_wild             -> the GROW payment
 *   @convert     action_convert (Notice Board) | action_harvest -> what full means
 *   @cost_icon   build | caboose | game_end                    -> by card type
 *   @cost1..6    one icon per unit of buildCost                -> crop or wild
 *   @cost_bar    cost_bg_<n> where n is that icon count
 *   @top_bar     ability_bg_<suit>, on every card and always at the top
 *
 * ⭐ v31 (02/09/2026). THREE THINGS LEFT THIS MODULE AT ONCE, and all three were
 * the same rule seen from different sides:
 *
 *   - **`upgraded` is gone.** Starters have ONE printed face for the whole game
 *     (design-changes-v31 §1.4), so `faceOf`'s two-face pick is a straight card
 *     lookup and every caller drops its second argument. The renderer no longer
 *     has a concept of a card with a back to flip to.
 *   - **The coin cost icon is gone.** `CostIcon` is crop-or-wild. The 30 Power
 *     and Endgame cards that printed two coins now print two crop icons of their
 *     own suit, and they arrive here already shaped that way in `buildCost`.
 *   - **A starter prints NO cost bar.** It used to print the GBP 2 that flipped
 *     it. There is no flip and there is no currency, so `costIcons` returns
 *     nothing for a card with no build cost, full stop. That is the whole of
 *     "remove every upgrade affordance" at this layer: nothing downstream can
 *     draw a price that does not exist.
 *
 * `handSize` went with the Barn's printed hand limit - there is no hand limit -
 * so the Barn now prints nothing at all and is simply where cards ready for
 * delivery are stored.
 *
 * Verified against the sheet for W1/W2/W3/W4/W7/W10/W13/W18/W19/V1/O2, and
 * asserted for all 105 cards by printed.test.ts - which is what stops the web
 * card and the printed card drifting apart.
 */

import type { Card, GameData, Suit } from '@gp/data';

export type CostIcon = { kind: 'crop'; suit: Suit } | { kind: 'wild' };

export interface PrintedFace {
  readonly id: string;
  readonly suit: Suit;
  readonly name: string;
  readonly abilityText: string;
  readonly printedVp: number;
  /** Stack slots. Null on a card that is not a stacking building (Barn, Farmstead, Power, Endgame). */
  readonly threshold: number | null;
  /** The suit a GROW payment must match; 'wild' = any card. Null when the face never activates. */
  readonly activation: Suit | 'wild' | null;
  /** What reaching the threshold is for: harvest, or the Notice Board's visitor door. */
  readonly convert: 'harvest' | 'convert' | null;
  /** The chip on the left: the generic starting-building icon, or the crop. */
  readonly identityIcon: 'starter' | Suit;
  /** Empty when the face is not buildable, which since v31 is exactly the fifteen starters. */
  readonly cost: readonly CostIcon[];
  /** The icon at the head of the cost bar. Null when there is no cost bar. */
  readonly costIcon: 'build' | 'caboose' | 'game_end' | null;
}

function costIcons(card: Card): CostIcon[] {
  const cost = card.buildCost;
  // A starter is never bought and never flipped (v31), so it prints no bar.
  if (!cost) return [];
  return [
    ...Array.from({ length: cost.suit }, () => ({ kind: 'crop', suit: card.suit }) as CostIcon),
    ...Array.from({ length: cost.wild }, () => ({ kind: 'wild' }) as CostIcon),
  ];
}

function costIconFor(card: Card): PrintedFace['costIcon'] {
  if (card.type === 'power') return 'caboose';
  if (card.type === 'endgame') return 'game_end';
  return 'build';
}

export function printedFace(data: GameData, id: string): PrintedFace {
  const card = data.cards.catalogue.find((c) => c.id === id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  const activation = (card.activationType ?? null) as Suit | 'wild' | null;
  const cost = costIcons(card);
  const isNoticeBoard = card.slot === 'noticeboard';

  return {
    id: card.id,
    suit: card.suit,
    name: card.name,
    abilityText: card.abilityText,
    printedVp: card.printedVp,
    threshold: card.threshold,
    activation,
    convert: card.threshold === null ? null : isNoticeBoard ? 'convert' : 'harvest',
    // Ticket 07's rule, unchanged by v31: a starter prints the generic
    // starting-building icon and counts for no crop. What changed is that there
    // is no longer a second face on which it printed the crop instead.
    identityIcon: card.type === 'starter' ? 'starter' : card.suit,
    cost,
    costIcon: cost.length === 0 ? null : costIconFor(card),
  };
}
