/**
 * The suit palette and the colour pairs the visual layer draws with, held to
 * WCAG 2.2 (25/09/2026, WP2 / B16).
 *
 * Contrast used to be argued in comments (`base.css`, `suits.ts`) and checked
 * by a throwaway sweep, which is how white-on-Wheat (1.23:1) and white-on-Apiary
 * (2.38:1) shipped on the start screen's chips. The numbers are now asserted:
 * change a colour and this file says whether the change still reads.
 *
 * The tokens are read OUT OF THE STYLESHEETS rather than copied here, so the
 * test cannot drift from what the browser paints.
 *
 *   text          4.5:1   (WCAG 1.4.3)
 *   large text    3:1     18px, or 14px bold - Orchard's white label only
 *   boundaries    3:1     (WCAG 1.4.11) a control edge or a swatch rim
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SUIT_META } from './suits';

function css(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8');
}

const TOKENS = css('tokens.css') + css('base.css');

/** The first `--name: #hex` in `:root` - the resting (1600) value. */
function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(TOKENS);
  if (!m) throw new Error(`no hex token ${name}`);
  return m[1]!.toLowerCase();
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const WHITE = '#ffffff';
const TEXT = 4.5;
const LARGE = 3;
const BOUNDARY = 3;

/**
 * Every ground quiet text sits on. `#efe6d1` is the body gradient's darkest
 * stop, which is where most chromeless text now lands (see `base.css`).
 */
const GROUNDS = {
  panel: '#fdfaf1',
  hero: '#fdf7e8',
  paper: '#f7f1e3',
  gradient: '#efe6d1',
  deep: '#ece2cb',
} as const;

const SUITS = Object.entries(SUIT_META);

describe('the ruled suit colours (Dean, 19/09/2026)', () => {
  it('Wheat and Dairy are the action colours', () => {
    expect(SUIT_META.wheat.art).toBe('#fceb3d');
    expect(SUIT_META.dairy.art).toBe('#efedee');
    expect(SUIT_META.wheat.pip).toBe('#fceb3d');
    expect(SUIT_META.dairy.pip).toBe('#efedee');
  });

  it('Orchard, Apiary and Vegetable keep their swatches', () => {
    expect(SUIT_META.orchard.art).toBe('#ca5744');
    expect(SUIT_META.apiary.art).toBe('#e7963b');
    expect(SUIT_META.vegetable.art).toBe('#9cac85');
  });
});

describe('SUIT_META contrast', () => {
  it.each(SUITS)('%s ink is text-legible on every paper ground', (_, meta) => {
    for (const ground of Object.values(GROUNDS)) {
      expect(contrast(meta.ink, ground)).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(SUITS)('%s ink carries white text (filled buttons, turn badges)', (_, meta) => {
    expect(contrast(WHITE, meta.ink)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(SUITS)('%s edge is a visible boundary on every paper ground', (_, meta) => {
    for (const ground of Object.values(GROUNDS)) {
      expect(contrast(meta.edge, ground)).toBeGreaterThanOrEqual(BOUNDARY);
    }
  });

  it.each(SUITS)('%s text on its own pip', (suit, meta) => {
    const ratio = contrast(meta.onPip, meta.pip);
    // Orchard red carries white at LARGE sizes only: no small-text colour
    // clears 4.5:1 on #ca5744 (white 4.24, dark brown 2.39).
    expect(ratio).toBeGreaterThanOrEqual(suit === 'orchard' ? LARGE : TEXT);
  });

  it('white is never the text colour on the Wheat or Apiary pip', () => {
    expect(SUIT_META.wheat.onPip).not.toBe(WHITE);
    expect(SUIT_META.apiary.onPip).not.toBe(WHITE);
    // And for the record, why: both are far below even the large-text floor.
    expect(contrast(WHITE, '#fceb3d')).toBeLessThan(LARGE);
    expect(contrast(WHITE, '#e7963b')).toBeLessThan(LARGE);
  });

  it('dark brown text is never set on the Orchard pip', () => {
    expect(contrast('#5a4632', SUIT_META.orchard.pip)).toBeLessThan(LARGE);
    expect(SUIT_META.orchard.onPip).toBe(WHITE);
  });
});

/**
 * The text/background pairs `play.css` and `card.css` actually draw, by token.
 * [what it is, text, ground, floor]
 */
const PAIRS: readonly (readonly [string, string, string, number])[] = [
  ['body ink on the paper', token('--ink'), GROUNDS.paper, TEXT],
  ['body ink on the gradient', token('--ink'), GROUNDS.gradient, TEXT],
  ['body ink on a hovered button', token('--ink'), token('--paper-deep'), TEXT],
  [
    'soft ink on the gradient (captions, zone heads, done state)',
    token('--ink-soft'),
    GROUNDS.gradient,
    TEXT,
  ],
  ['soft ink on a hovered button', token('--ink-soft'), token('--paper-deep'), TEXT],
  ['card title plate', token('--ink-strong'), token('--plate'), TEXT],
  ['primary button', WHITE, token('--go'), TEXT],
  ['primary button, hovered', WHITE, token('--go-deep'), TEXT],
  ['selected start-screen choice', WHITE, token('--ink'), TEXT],
  ['answer and chip text', token('--ink'), token('--paper'), TEXT],
  ['visit chip hover', token('--ink'), token('--go-wash'), TEXT],
  ['turn note (the Wheat ink)', SUIT_META.wheat.ink, GROUNDS.gradient, TEXT],
  ['result warning', token('--stop'), token('--paper-panel'), TEXT],
  // Disabled text is exempt from 1.4.3, but a label nobody can read cannot say
  // what is shut, so it is held to the large-text floor.
  ['disabled label', token('--disabled-ink'), token('--disabled-fill'), LARGE],
];

/** Control and focus boundaries: [what it is, edge, ground]. */
const EDGES: readonly (readonly [string, string, string])[] = [
  ['control edge on the paper', token('--edge'), GROUNDS.paper],
  ['control edge on the gradient', token('--edge'), GROUNDS.gradient],
  ['disabled edge on its fill', token('--disabled-edge'), token('--disabled-fill')],
  ['disabled edge on the gradient', token('--disabled-edge'), GROUNDS.gradient],
  ['focus ring on the paper', token('--focus'), GROUNDS.paper],
  ['focus ring on the gradient', token('--focus'), GROUNDS.gradient],
  ['go outline on the paper', token('--go'), GROUNDS.paper],
];

describe('the visual layer draws only legible pairs', () => {
  it.each(PAIRS)('%s', (_, fg, bg, floor) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(floor);
  });

  it.each(EDGES)('%s', (_, edge, ground) => {
    expect(contrast(edge, ground)).toBeGreaterThanOrEqual(BOUNDARY);
  });
});

describe('the stylesheets keep the rules', () => {
  const files = { 'play.css': css('play.css'), 'card.css': css('card.css') };

  it.each(Object.entries(files))('%s sets no text below the 12px floor', (_, text) => {
    expect(text).not.toMatch(/font-size:\s*(9|10|11)px/);
  });

  it.each(Object.entries(files))('%s never sets white text on a seat pip', (_, text) => {
    // A rule block that fills with the pip and writes white on it is exactly
    // the start-screen chip that read 1.23:1 on Wheat.
    for (const block of text.split('}')) {
      const onPip = /background(-color)?:\s*var\(--seat-pip/.test(block);
      const white = /(^|[^-])color:\s*(#fff\b|#ffffff\b|white\b)/.test(block);
      expect(onPip && white, block.trim().slice(0, 80)).toBe(false);
    }
  });

  it('play.css dims nothing by opacity on a control', () => {
    const text = files['play.css'];
    for (const sel of [
      '.action:disabled',
      '.exit:disabled',
      '.primary:disabled',
      '.ghost:disabled',
    ]) {
      const at = text.indexOf(sel);
      expect(at, sel).toBeGreaterThan(-1);
      const block = text.slice(at, text.indexOf('}', at));
      expect(block, sel).not.toMatch(/opacity/);
    }
  });
});
