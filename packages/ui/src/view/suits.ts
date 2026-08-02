/**
 * The suit palette, derived from the printed cards rather than invented.
 *
 * `art` is the exact flat colour of `frame/card_bg_<suit>.webp`, sampled off the
 * asset, so a panel tinted with it sits on the same chord as the card it frames.
 * `pip` is a separate, deliberately louder value: at stack-gauge size the five
 * printed colours do NOT read apart, because Wheat (#e2c488) and Dairy (#f4d68d)
 * are both pale tans. Pushing Wheat to gold and Dairy to near-cream separates
 * them at 10px, which the mixed-colour stack story depends on - "your junk is
 * their treasure" is only legible if you can see whose colours are in a stack.
 * `ink` is the darkened value for text and borders on a pale ground.
 */

import type { Suit } from '@gp/data';

export interface SuitMeta {
  readonly label: string;
  /** Sampled from frame/card_bg_<suit>.webp. */
  readonly art: string;
  /** Stack pips, rail dots, deck spines. Separated for legibility, not fidelity. */
  readonly pip: string;
  /** Borders and text on a pale ground. */
  readonly ink: string;
  /** A wash for panel backgrounds. */
  readonly wash: string;
}

export const SUIT_META: Readonly<Record<Suit, SuitMeta>> = {
  wheat: { label: 'Wheat', art: '#e2c488', pip: '#d9a520', ink: '#9c6f11', wash: '#f7edd6' },
  vegetable: {
    label: 'Vegetable',
    art: '#9cac85',
    pip: '#6c9550',
    ink: '#456533',
    wash: '#e6eddd',
  },
  orchard: { label: 'Orchard', art: '#ca5744', pip: '#ca5744', ink: '#9c3a2a', wash: '#f8e2dd' },
  apiary: { label: 'Apiary', art: '#e7963b', pip: '#e7963b', ink: '#b06813', wash: '#fbeada' },
  dairy: { label: 'Dairy', art: '#f4d68d', pip: '#f6e6b4', ink: '#8d7434', wash: '#fbf3dd' },
};

/** The colour a masked card shows: suit is public, identity is not. */
export const UNKNOWN_PIP = '#b9ab95';

export function suitLabel(suit: Suit): string {
  return SUIT_META[suit].label;
}

/**
 * How a seat is named in the interface. The seat's suit IS its identity - there
 * are no player colours in this game beyond the crop they farm.
 */
export function seatName(suit: Suit | undefined, seat: number, you: number): string {
  const label = suit ? SUIT_META[suit].label : `Seat ${seat}`;
  return seat === you ? `You (${label})` : `${label} farm`;
}
