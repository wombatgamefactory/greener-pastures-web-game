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
 *
 * ⭐ THREE OF THE FIVE INKS WERE DARKENED AGAIN IN PHASE 5, and the reason is
 * the same one that made phase 3 pick `ink` over `pip` for the turn bar's go
 * light: these values were set against the panel tone every region used to
 * wear, and phase 2 took that panel away. Quiet type now sits on the body
 * gradient, whose darkest stop is #efe6d1, and Wheat, Apiary and Dairy all
 * failed WCAG AA there while setting 9px deck labels and feed leads:
 *
 *   Wheat  #9c6f11 -> #855e0e   3.60 -> 4.69      Orchard #9c3a2a  5.54  kept
 *   Apiary #b06813 -> #935710   3.50 -> 4.68      Veg     #456533  5.35  kept
 *   Dairy  #8d7434 -> #78632c   3.61 -> 4.67
 *
 * Orchard and Vegetable already cleared 4.5:1 and were LEFT ALONE rather than
 * moved for tidiness. The five inks are not a gradient anybody reads across;
 * each one only ever has to be legible on paper, so changing the two that pass
 * would have cost fidelity to the printed card for nothing.
 *
 * Each new value is the old one multiplied down in RGB, which holds the hue and
 * the saturation ratio: this is the same ink, printed heavier, not a new colour.
 * The full ladder and the ground it is measured against are in `base.css`.
 *
 * ⭐ 25/09/2026: WHEAT AND DAIRY MOVE TO THE ACTION COLOURS (B16). Dean ruled on
 * 19/09/2026 that the crop swatches move to the player-aid action colours, so
 * one colour means one suit everywhere: Wheat is #fceb3d (the Harvest yellow)
 * and Dairy #efedee (the Build white), for `art` and `pip` alike. That also
 * dissolves the reason `pip` was ever pushed away from `art` for those two -
 * the old tans sat 43 RGB apart and the new pair are unmistakable - so the two
 * fields now agree for four of the five crops. Vegetable keeps its louder pip.
 * The inks are unchanged: each still clears 4.5:1 on every paper, and the test
 * in `suits.test.ts` says so rather than this comment.
 *
 * The cost of the ruling is that two pips are now nearly the colour of the
 * paper (Wheat 1.1:1, Dairy 1.2:1), so a pip alone can no longer be a boundary.
 * `edge` is the answer: a same-hue colour at 3:1 or better for any border,
 * underline or swatch rim drawn on paper. Pips stay pips where they sit on the
 * dark stack gauge, which is where the five have to read apart.
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
  /**
   * A BOUNDARY in the suit's colour that can be seen on paper: at least 3:1
   * against the body gradient's darkest stop #efe6d1 (WCAG 1.4.11). For the
   * suits whose pip is dark enough it is the pip itself; Wheat, Apiary and
   * Dairy pips are 1.1 to 1.9:1 on paper and need a darker edge of the same hue
   * (Dairy, near-white since 19/09/2026, takes a neutral pencil grey).
   */
  readonly edge: string;
  /**
   * Text drawn ON the pip. Dark ink on the four light pips; Orchard's red
   * carries white, and only at LARGE sizes (18px, or 14px bold): white on
   * #ca5744 is 4.24:1 and dark brown on it 2.39:1, so no small text is ever
   * set on an Orchard pip. `suits.test.ts` enforces both.
   */
  readonly onPip: string;
}

export const SUIT_META: Readonly<Record<Suit, SuitMeta>> = {
  wheat: {
    label: 'Wheat',
    art: '#fceb3d',
    pip: '#fceb3d',
    ink: '#855e0e',
    wash: '#fbf5d2',
    edge: '#9e7700',
    onPip: '#2f2318',
  },
  vegetable: {
    label: 'Vegetable',
    art: '#9cac85',
    pip: '#6c9550',
    ink: '#456533',
    wash: '#e6eddd',
    edge: '#5f8746',
    onPip: '#1f170f',
  },
  orchard: {
    label: 'Orchard',
    art: '#ca5744',
    pip: '#ca5744',
    ink: '#9c3a2a',
    wash: '#f8e2dd',
    edge: '#ca5744',
    onPip: '#ffffff',
  },
  apiary: {
    label: 'Apiary',
    art: '#e7963b',
    pip: '#e7963b',
    ink: '#935710',
    wash: '#fbeada',
    edge: '#b06a1c',
    onPip: '#2f2318',
  },
  dairy: {
    label: 'Dairy',
    art: '#efedee',
    pip: '#efedee',
    ink: '#78632c',
    wash: '#f6f4f2',
    edge: '#7d7879',
    onPip: '#2f2318',
  },
};

/** The colour a masked card shows: suit is public, identity is not. */
export const UNKNOWN_PIP = '#b9ab95';

export function suitLabel(suit: Suit): string {
  return SUIT_META[suit].label;
}

/**
 * "a Wheat card", "an Apiary card".
 *
 * Two of the five crops begin with a vowel, and until 03/09/2026 every surface
 * that named a MASKED card hard-coded "a " - so a rival's draw, a card in limbo
 * and a card in flight all read "a Apiary card" and "a Orchard card". It was
 * invisible for a long time because the phrase is only reached through
 * redaction, and the seed positions the tests pin are mostly Wheat and
 * Vegetable; the Dairy reveals of 03/09 put it in front of a reader.
 *
 * A function rather than a sixth field on `SUIT_META`, because the article
 * belongs to the sentence and not to the crop: the same label is written "the
 * Apiary door" and "an Apiary card" a line apart.
 */
export function suitArticle(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

/** The whole phrase a masked card is named by: its crop is public, its identity is not. */
export function maskedCardPhrase(suit: Suit | undefined): string {
  if (!suit) return 'a card';
  const label = SUIT_META[suit].label;
  return `${suitArticle(label)} ${label} card`;
}

/**
 * How a seat is named in the interface. The seat's suit IS its identity - there
 * are no player colours in this game beyond the crop they farm.
 */
export function seatName(suit: Suit | undefined, seat: number, you: number): string {
  const label = suit ? SUIT_META[suit].label : `Seat ${seat}`;
  return seat === you ? `You (${label})` : `${label} farm`;
}
