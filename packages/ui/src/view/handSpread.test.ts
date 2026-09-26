import { describe, expect, it } from 'vitest';

import { previewBox, spreadShifts } from './handSpread';

// Five 100px cards resting 90px apart from x=0; the row is 0..900.
const lefts = [0, 90, 180, 270, 360];
const base = { cardWidth: 100, boundL: 0, boundR: 900 };

describe('previewBox', () => {
  it('keeps the top level with the hand and is three times as wide where it fits', () => {
    const box = previewBox({ ...base, cardLeft: 180, cardTop: 400, viewportH: 1000 });
    expect(box.top).toBe(400);
    expect(box.width).toBe(300);
    expect(box.left).toBe(80);
  });

  it('shrinks to the room below the hand, never under twice the card', () => {
    const box = previewBox({ ...base, cardLeft: 180, cardTop: 700, viewportH: 900 });
    expect(box.width).toBeLessThan(300);
    expect(box.width).toBeGreaterThanOrEqual(200);
  });
});

describe('spreadShifts', () => {
  it('moves no card onto the preview and leaves the hovered card alone', () => {
    const box = previewBox({ ...base, cardLeft: 180, cardTop: 400, viewportH: 1000 });
    const shifts = spreadShifts({ ...base, lefts, hovered: 2, preview: box });
    expect(shifts[2]).toBe(0);
    for (const i of [0, 1]) {
      expect((lefts[i] as number) + (shifts[i] as number) + 100).toBeLessThanOrEqual(box.left);
    }
    for (const i of [3, 4]) {
      expect((lefts[i] as number) + (shifts[i] as number)).toBeGreaterThanOrEqual(
        box.left + box.width,
      );
    }
  });

  it('closes a group up rather than pushing it out of the row', () => {
    const box = previewBox({ ...base, cardLeft: 360, cardTop: 400, viewportH: 1000 });
    const shifts = spreadShifts({ ...base, lefts, hovered: 4, preview: box });
    expect((lefts[0] as number) + (shifts[0] as number)).toBeGreaterThanOrEqual(0);
    expect((lefts[3] as number) + (shifts[3] as number) + 100).toBeLessThanOrEqual(box.left);
  });
});
