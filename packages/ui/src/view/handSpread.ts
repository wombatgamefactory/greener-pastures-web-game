/**
 * Where the hand's cards go while one of them is previewed (26/09/2026, Dean):
 * the hovered card is drawn large with its top level with the hand's top, and
 * every other card slides left or right out from under it, so the whole hand
 * stays visible and nothing is covered.
 *
 * Pure arithmetic over resting geometry, so it can be tested without a DOM and
 * can never feed back on itself: the inputs are the RESTING left edges of the
 * slots (which never move; only the drawn card inside each slot is shifted),
 * so the answer depends on which card is hovered and nothing else.
 */

/** Card height over width, from `.card`'s aspect-ratio in card.css. */
export const CARD_ASPECT = 750 / 1039;

export interface PreviewBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/**
 * The preview's box. Its top is level with the hand's top; it is `scale` times
 * the hand card wide where the screen allows, shrinking (never below `floor`
 * times) to fit the room below the hand, and rising only if even that will not
 * fit. Centred on the hovered card and clamped into `[boundL, boundR]`.
 */
export function previewBox(opts: {
  readonly cardLeft: number;
  readonly cardTop: number;
  readonly cardWidth: number;
  readonly boundL: number;
  readonly boundR: number;
  readonly viewportH: number;
  readonly scale?: number;
  readonly floor?: number;
  readonly margin?: number;
}): PreviewBox {
  const { cardLeft, cardTop, cardWidth, boundL, boundR, viewportH } = opts;
  const scale = opts.scale ?? 3;
  const floor = opts.floor ?? 2;
  const margin = opts.margin ?? 8;
  const below = viewportH - cardTop - margin;
  const width = Math.round(
    Math.min(
      cardWidth * scale,
      Math.max(cardWidth * floor, below / CARD_ASPECT),
      Math.max(cardWidth, boundR - boundL),
    ),
  );
  const height = width * CARD_ASPECT;
  const centred = cardLeft + cardWidth / 2 - width / 2;
  const left = Math.max(boundL, Math.min(centred, boundR - width));
  const top = Math.max(margin, Math.min(cardTop, viewportH - margin - height));
  return { left, top, width };
}

/**
 * The horizontal shift (px) for each card in the hand. The hovered card does
 * not move (the preview covers it); cards to its left end `gap` px before the
 * preview's left edge, cards to its right start `gap` px after its right edge,
 * each group spreading evenly across the room on its side, up to cards that
 * do not overlap at all, and overlapping one another (never the preview)
 * where the room is short. A group is
 * kept inside `[boundL, boundR]` while it can be; with no room at all it
 * overlaps down to `minStep` px per card rather than disappearing.
 */
export function spreadShifts(opts: {
  readonly lefts: readonly number[];
  readonly cardWidth: number;
  readonly hovered: number;
  readonly preview: PreviewBox;
  readonly boundL: number;
  readonly boundR: number;
  readonly gap?: number;
  readonly minStep?: number;
}): number[] {
  const { lefts, cardWidth: cw, hovered, preview, boundL, boundR } = opts;
  const gap = opts.gap ?? 8;
  const minStep = opts.minStep ?? 12;
  const n = lefts.length;
  const shifts = new Array<number>(n).fill(0);
  if (n <= 1 || hovered < 0 || hovered >= n) return shifts;
  // A group spreads into all the room on its side, up to cards that no
  // longer overlap one another at all (`openStep`).
  const openStep = cw + gap;

  // Left group: indices 0 .. hovered-1, laid out right to left.
  const leftCount = hovered;
  if (leftCount > 0) {
    const last = lefts[hovered - 1] as number;
    const end = Math.min(last + cw, preview.left - gap);
    const room = end - cw - boundL;
    const step =
      leftCount === 1 ? openStep : Math.max(minStep, Math.min(openStep, room / (leftCount - 1)));
    for (let i = hovered - 1, x = end - cw; i >= 0; i--, x -= step) {
      shifts[i] = Math.min(0, x - (lefts[i] as number));
    }
  }

  // Right group: indices hovered+1 .. n-1, laid out left to right.
  const rightCount = n - hovered - 1;
  if (rightCount > 0) {
    const first = lefts[hovered + 1] as number;
    const start = Math.max(first, preview.left + preview.width + gap);
    const room = boundR - cw - start;
    const step =
      rightCount === 1 ? openStep : Math.max(minStep, Math.min(openStep, room / (rightCount - 1)));
    for (let i = hovered + 1, x = start; i < n; i++, x += step) {
      shifts[i] = Math.max(0, x - (lefts[i] as number));
    }
  }
  return shifts;
}
