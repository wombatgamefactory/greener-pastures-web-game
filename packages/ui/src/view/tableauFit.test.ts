/**
 * T10b (26/09/2026): the building-size fit that ended QA D1 (buildings cut in
 * half at 1600x900). The one property that matters is that whatever this
 * returns, the rows it implies fit the height it was given.
 */
import { describe, expect, it } from 'vitest';

import { CARD_RATIO, FIT_FLOOR, fitTableau } from './tableauFit';

const tall = (w: number) => Math.ceil(w * CARD_RATIO) + 1;

describe('fitTableau', () => {
  it('keeps the ladder size when a row fits', () => {
    expect(fitTableau(5, 120, 900, 100)).toEqual({ width: 120, scrollRows: null });
  });

  it('shrinks to fit two rows rather than slicing the second', () => {
    const fit = fitTableau(14, 120, 900, 170);
    expect(fit.scrollRows).toBeNull();
    const perRow = Math.floor((900 + 6) / (fit.width + 6));
    const rows = Math.ceil(14 / perRow);
    expect(rows * tall(fit.width) + (rows - 1) * 6).toBeLessThanOrEqual(170);
    expect(fit.width).toBeGreaterThanOrEqual(Math.round(120 * FIT_FLOOR));
  });

  it('scrolls sideways, whole rows only, when even the floor size cannot fit', () => {
    const fit = fitTableau(14, 120, 500, 95);
    expect(fit.scrollRows).toBe(1);
    expect(tall(fit.width)).toBeLessThanOrEqual(95 - 10);
  });

  it('never returns a card taller than the room, at any size', () => {
    for (const ladder of [78, 84, 92, 120, 150, 200, 280])
      for (const h of [60, 75, 90, 130, 200, 320])
        for (const n of [1, 4, 8, 14, 20]) {
          const fit = fitTableau(n, ladder, 800, h);
          const rows =
            fit.scrollRows ?? Math.ceil(n / Math.max(1, Math.floor(806 / (fit.width + 6))));
          const bar = fit.scrollRows === null ? 0 : 10;
          expect(rows * tall(fit.width) + (rows - 1) * 6 + bar).toBeLessThanOrEqual(h);
        }
  });
});
