/**
 * T10b (26/09/2026): HOW BIG YOUR BUILDINGS ARE, DECIDED BY THE ROOM THE FARM
 * ACTUALLY HAS - so a building is never drawn cut in half.
 *
 * ⛔ THE DEFECT THIS REPLACES (QA D1, 26/09/2026). The building width was a
 * fixed rung of the size ladder (`--card-building`, 120px at 1600x900, so 87px
 * tall), while the tableau's row in the farm's grid was `minmax(60px, 1fr)`:
 * whatever the head, the Worker strip, the hand and the Farmstead left. At an
 * ordinary turn-top at 1600x900 that was 60 to 83px, so every building lost
 * its bottom third - the stack gauge and the foot of the art - on every turn,
 * and a 2p farm of 10 to 14 buildings sliced its second row even at 2560. The
 * two numbers were set in two different files and nothing tied them together.
 *
 * Now they are tied, here. The ladder rung is still the size a building WANTS
 * to be; this picks the largest width at or under it whose rows all fit the
 * height the tableau really has. Only when even a floor size (72% of the rung)
 * cannot hold every row does the tableau stop wrapping and scroll SIDEWAYS
 * instead - as many whole rows as fit, never a partial one. Nothing is ever
 * clipped vertically: the failure mode moves from "half a card" to "a scroll
 * bar and a fade at the right edge", which says there is more.
 *
 * Pure, so it can be asserted without a browser (`tableauFit.test.ts`); the
 * measuring half is `useTableauFit` in `Farm.tsx`.
 */

/** A printed card's height over its width: the 1039 x 750 sheet. */
export const CARD_RATIO = 750 / 1039;

/** Below this share of the ladder rung, scroll sideways rather than shrink. */
export const FIT_FLOOR = 0.72;

export interface TableauFit {
  /** The building card width to draw, in CSS px. */
  readonly width: number;
  /**
   * `null` when every building fits by wrapping; otherwise the number of whole
   * rows that fit, laid out in columns that scroll sideways.
   */
  readonly scrollRows: number | null;
}

/**
 * @param n       buildings in the tableau
 * @param ladder  the ladder's building width (`--card-building`)
 * @param width   the tableau's inner width available to cards
 * @param height  the tableau's height available to cards
 * @param gap     the gap between cards (`.tableau` `gap`)
 * @param scrollbar height a horizontal scrollbar takes when it is needed
 */
export function fitTableau(
  n: number,
  ladder: number,
  width: number,
  height: number,
  gap = 6,
  scrollbar = 10,
): TableauFit {
  const tall = (w: number) => Math.ceil(w * CARD_RATIO) + 1;
  if (n === 0 || !(width > 0) || !(height > 0)) return { width: ladder, scrollRows: null };
  const floor = Math.max(40, Math.round(ladder * FIT_FLOOR));
  for (let w = ladder; w >= floor; w -= 2) {
    const perRow = Math.max(1, Math.floor((width + gap) / (w + gap)));
    const rows = Math.ceil(n / perRow);
    if (rows * tall(w) + (rows - 1) * gap <= height) return { width: w, scrollRows: null };
  }
  // Even the floor size cannot hold every row: scroll sideways, whole rows only.
  const room = height - scrollbar;
  let w = floor;
  if (tall(w) > room) w = Math.max(32, Math.floor((room - 1) / CARD_RATIO));
  const rows = Math.max(1, Math.floor((room + gap) / (tall(w) + gap)));
  return { width: w, scrollRows: rows };
}
