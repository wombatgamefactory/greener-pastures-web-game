/**
 * Dock magnification, checked where the deleted hover-zoom went wrong.
 *
 * Phase 1 removed a hover scale because the enlarged card covered the
 * neighbours you were reaching for next, and the whole argument for putting a
 * magnifier back is that a dock pushes the neighbours apart instead.
 *
 * ⭐ WHAT THIS FILE PINS WAS REWRITTEN TWICE ON 27/08/2026, AND THE SECOND
 * REWRITE IS THE INTERESTING ONE BECAUSE IT UNDID AN OVER-CORRECTION.
 *
 * Cut one pinned "no gap in the row ever closes", measured against the RESTING
 * fan - which overlaps by design (`--hand-fan`), so a strip that satisfied it
 * was still a row of cards half hidden behind each other. Cut two replaced that
 * with TOTAL SEPARATION: one constant gap between every pair, everywhere, at
 * every pointer position, bought before any magnification. It passed, and the
 * feature came out worse - the row's whole spare width went on opening gaps in
 * the tail where nothing was growing, and the wave that was left measured
 *
 *      1.12   1.36   1.48   1.36   1.12
 *
 * at the desktop step, which nobody could point at and call a magnifier.
 *
 * So the property pinned here is now the NARROWER, TRUER one:
 *
 *   ⭐ NOTHING THAT IS GROWING EVER LAPS ANYTHING.
 *
 * Where the wave is, the gaps are open by the printed amount and every card is
 * whole. Out in the tail, where every card sits at scale 1, the fan is a fan -
 * because that is what the hand looks like at rest, it costs nothing, and it is
 * the width the peak needed. `openings` below is the arithmetic of exactly
 * where the one becomes the other, and the sweeps check it at half-pixel steps.
 *
 * The other half is the oscillation guard. A dock computed from where the cards
 * are NOW is a feedback loop, so `dockPlacements` takes a resting position and
 * is a pure function of it. Purity and continuity are the two things that make
 * the loop impossible, and both are asserted below - a sweep at half-pixel
 * steps must never produce a jump, which is exactly the shape jitter would take.
 */

import { describe, expect, it } from 'vitest';

import {
  DOCK_GAP,
  DOCK_OPEN_GAIN,
  DOCK_RADIUS_MAX,
  DOCK_RADIUS_MIN,
  dockAnchors,
  dockBeats,
  dockBump,
  dockOpening,
  dockPlacements,
  dockRise,
  dockSpread,
} from './dock';
import type { DockAnchors } from './dock';

/** The shipped tokens, so the fixtures move when `base.css` does. */
const PEAK = 2.3;
const MIN = 0.65;

/** A fan of `n` cards `width` wide, advancing by `advance` each. */
function fan(
  n: number,
  width: number,
  advance: number,
  budget: number,
  peak = PEAK,
  min = MIN,
): DockAnchors {
  const lefts = Array.from({ length: n }, (_, i) => 100 + i * advance);
  const anchors = dockAnchors(lefts, width, budget, peak, min);
  if (!anchors) throw new Error('no anchors');
  return anchors;
}

/**
 * The shapes the real ladder produces, plus the degenerate ones.
 *
 * ⚠️ THE BUDGETS ARE THE FARM'S LEFT COLUMN, NOT THE HAND'S ROW. The strip may
 * lift clear of the barn before it spends the barn's column, so the room it can
 * have runs from the resting fan's right edge to the seam with the reading
 * region. Measured in a browser at each step, five cards and six.
 */
const SHAPES: { name: string; n: number; width: number; advance: number; budget: number }[] = [
  { name: 'floor, 5 cards, overlapping', n: 5, width: 88, advance: 79, budget: 381 },
  { name: 'floor, 6 cards, overlapping', n: 6, width: 88, advance: 79, budget: 302 },
  { name: 'laptop, 6 cards', n: 6, width: 106, advance: 95, budget: 179 },
  { name: 'desktop, 5 cards', n: 5, width: 130, advance: 117, budget: 308 },
  { name: 'desktop, 5 cards, its own row only', n: 5, width: 130, advance: 117, budget: 208 },
  { name: 'desktop, 6 cards', n: 6, width: 130, advance: 117, budget: 191 },
  { name: 'qhd, 5 cards, separated at rest', n: 5, width: 300, advance: 306, budget: 202 },
  { name: 'qhd, 6 cards, cannot be separated', n: 6, width: 300, advance: 246, budget: 196 },
  { name: 'separation bought, little else', n: 6, width: 300, advance: 290, budget: 160 },
  { name: 'a hand of one', n: 1, width: 130, advance: 117, budget: 400 },
  { name: 'a hand of two', n: 2, width: 130, advance: 117, budget: 400 },
  { name: 'a row with no spare width at all', n: 6, width: 300, advance: 264, budget: 0 },
];

/** Left edge, right edge, scale and falloff of every card, once docked. */
function boxes(anchors: DockAnchors, pointer: number) {
  return dockPlacements(anchors, pointer).map((p, i) => {
    const centre = (anchors.lefts[i] as number) + anchors.width / 2 + p.shift;
    const half = (anchors.width * p.scale) / 2;
    return { left: centre - half, right: centre + half, scale: p.scale, bump: p.bump };
  });
}

/**
 * How far each gap is meant to have opened, 0 to 1: the model, restated.
 *
 * Restated rather than imported so the sweeps check the LAYOUT against the
 * rule, not the layout against itself. If `dockPlacements` ever stops laying
 * the strip out the way the rule says, this is what notices.
 */
function openings(anchors: DockAnchors, pointer: number): number[] {
  const b = boxes(anchors, pointer).map((x) => x.bump);
  return b.slice(1).map((next, i) => Math.min(1, Math.max(b[i] as number, next) * DOCK_OPEN_GAIN));
}

/**
 * Every pointer position worth trying, at half-pixel resolution.
 *
 * ⚠️ THE SWEEPS BELOW ACCUMULATE A WORST CASE AND ASSERT ONCE, WHICH IS NOT
 * TIDINESS. An `expect` per sample is a few microseconds, and twelve shapes at
 * eight thousand samples apiece put this file over the suite's per-test budget
 * on a busy machine - it timed out rather than failed, which is the least
 * useful thing a test can do. Plain arithmetic in the loop runs the same sweep
 * in a fiftieth of the time, and the shape's name is passed to the one
 * assertion so a failure still says which fan broke.
 */
function sweep(anchors: DockAnchors): number[] {
  const first = anchors.lefts[0] as number;
  const last = (anchors.lefts.at(-1) as number) + anchors.width;
  const out: number[] = [];
  for (let x = first - anchors.advance * 4; x <= last + anchors.advance * 4; x += 0.5) out.push(x);
  return out;
}

describe('dockBump', () => {
  it('peaks at the pointer and is exactly zero past the radius', () => {
    expect(dockBump(0, 3)).toBeCloseTo(1, 10);
    expect(dockBump(3, 3)).toBe(0);
    expect(dockBump(4.7, 3)).toBe(0);
    expect(dockBump(-4.7, 3)).toBe(0);
  });

  it('is symmetric and falls monotonically', () => {
    let last = 1;
    for (let d = 0; d <= 3; d += 0.05) {
      expect(dockBump(d, 3)).toBeCloseTo(dockBump(-d, 3), 12);
      expect(dockBump(d, 3)).toBeLessThanOrEqual(last + 1e-12);
      last = dockBump(d, 3);
    }
  });

  it('is flat at both ends, so growth neither jumps in nor stops dead', () => {
    // A raised cosine has zero slope at 0 and at the radius. Sampling the
    // difference either side is enough to catch a shape that does not.
    expect(dockBump(0, 3) - dockBump(0.05, 3)).toBeLessThan(0.005);
    expect(dockBump(2.95, 3) - dockBump(3, 3)).toBeLessThan(0.005);
  });
});

describe('dockAnchors', () => {
  it('spends the whole radius when the row is roomy', () => {
    const roomy = fan(5, 88, 79, 900);
    expect(roomy.radius).toBeCloseTo(DOCK_RADIUS_MAX, 6);
    expect(roomy.peak).toBeCloseTo(PEAK, 6);
    expect(roomy.spacing).toBeCloseTo(88 * (1 + DOCK_GAP), 6);
    expect(roomy.overlapped).toBe(false);
  });

  /*
   * ⭐ THE CONCESSION ORDER, AS THREE ASSERTIONS, AND IT IS THE OPPOSITE OF
   * WHAT THIS FILE ASSERTED EARLIER THE SAME DAY. The peak is bought first and
   * the falloff narrows to pay for it; only when the narrowest falloff still
   * overruns does the peak come down. See the file header for the measurement
   * that turned it round.
   */
  it('keeps the whole peak and narrows the falloff to pay for it', () => {
    const tight = fan(5, 130, 117, 308);
    expect(tight.peak).toBeCloseTo(PEAK, 6);
    expect(tight.spacing).toBeCloseTo(130 * (1 + DOCK_GAP), 6);
    expect(tight.overlapped).toBe(false);
    expect(tight.radius).toBeLessThan(DOCK_RADIUS_MAX);
    expect(tight.radius).toBeGreaterThanOrEqual(DOCK_RADIUS_MIN);
  });

  it('trims the peak only once the narrowest falloff still will not fit', () => {
    const crushed = fan(5, 300, 306, 202);
    expect(crushed.radius).toBeCloseTo(DOCK_RADIUS_MIN, 6);
    expect(crushed.peak).toBeGreaterThan(1);
    expect(crushed.peak).toBeLessThan(PEAK);
    // The gaps under the wave were still paid for: a trimmed wave is a wave.
    expect(crushed.spacing).toBeCloseTo(300 * (1 + DOCK_GAP), 6);
    expect(crushed.overlapped).toBe(false);
  });

  /*
   * ⚠️ THE HONEST FAILURE, WHICH THE SQUEEZE HAS MADE ALMOST UNREACHABLE - AND
   * THAT IS THE POINT, SO IT IS PINNED WITH THE SQUEEZE TURNED OFF.
   *
   * Six 300px cards need 1800px to stand side by side and the farm's left column
   * at 2560 is 1726px wide. With `min` at 1 - no shrink - no dial closes that
   * hole: the strip opens the gaps as far as the room stretches to, flags it,
   * and declines to draw a magnifier it would have to re-cover the cards to
   * afford. That was the state of every step above 1920 before the squeeze.
   */
  it('says so, rather than quietly re-covering, when separation cannot be had', () => {
    const short = fan(6, 300, 246, 40, PEAK, 1);
    expect(short.overlapped).toBe(true);
    expect(short.spacing).toBeLessThan(300);
    expect(short.peak).toBe(1);
    // And it is still wider than it rests: docking never tightens a fan.
    expect(short.spacing).toBeGreaterThan(short.advance);
  });

  it('never draws a strip tighter than the fan rests', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      expect(a.spacing, s.name).toBeGreaterThanOrEqual(a.advance - 1e-9);
    }
  });

  /*
   * ⭐ THE HEADLINE PROPERTY, AND THE WHOLE REASON THE SQUEEZE EXISTS: A ROW
   * WITH NOT ONE SPARE PIXEL STILL DRAWS A FULL WAVE.
   *
   * Six 300px cards in a row that ends exactly where they do. Every earlier cut
   * returned the off switch here, correctly, because there was no width to be
   * had - and that is precisely the shape of the hand at 2560, which is why the
   * feature did nothing on the screen it was being built for. The cards away
   * from the pointer pay for the one under it, so the budget stops being the
   * binding constraint.
   */
  it('draws a full wave in a row with no spare width at all', () => {
    const none = fan(6, 300, 264, 0);
    expect(none.peak).toBeGreaterThan(1.4);
    expect(none.min).toBeCloseTo(MIN, 9);
  });

  it('turns itself off when asked for neither growth nor shrink', () => {
    const off = fan(6, 300, 264, 400, 1, 1);
    expect(off.peak).toBe(1);
    expect(off.min).toBe(1);
    expect(off.spacing).toBeCloseTo(off.advance, 9);
    for (const p of dockPlacements(off, 400)) {
      expect(p.scale).toBe(1);
      expect(p.shift).toBe(0);
    }
  });

  /*
   * ⭐ AND THE CLAIM STATED AS A COMPARISON. On one budget, across every shape,
   * letting the tail shrink buys a taller wave than not letting it - never a
   * shorter one. If this ever fails, the trough has stopped paying and has
   * become just another thing competing for the row's width.
   */
  it('always buys a taller wave than the same row without the squeeze', () => {
    for (const s of SHAPES) {
      const squeezed = fan(s.n, s.width, s.advance, s.budget);
      const plain = fan(s.n, s.width, s.advance, s.budget, PEAK, 1);
      expect(squeezed.peak, s.name).toBeGreaterThanOrEqual(plain.peak - 1e-9);
    }
  });

  it('never exceeds the peak the token asked for', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      expect(a.peak, s.name).toBeLessThanOrEqual(PEAK + 1e-9);
      expect(a.peak, s.name).toBeGreaterThanOrEqual(1);
    }
  });

  /*
   * ⚠️ A ROW THAT CAN AFFORD MORE MUST NEVER DRAW LESS. Both dials are
   * monotone in the budget, which is what makes the search's early exit safe -
   * and it is the property that would break if somebody re-introduced a fixed
   * cost that the budget had to clear before anything was drawn at all.
   */
  it('never draws a smaller wave on a wider row', () => {
    for (const s of SHAPES) {
      let peak = 0;
      let radius = 0;
      for (let budget = 0; budget <= s.budget + 600; budget += 17) {
        const a = fan(s.n, s.width, s.advance, budget);
        if (a.peak > 1) {
          expect(a.peak, `${s.name} at ${budget}`).toBeGreaterThanOrEqual(peak - 1e-6);
          expect(a.radius, `${s.name} at ${budget}`).toBeGreaterThanOrEqual(radius - 1e-6);
          peak = a.peak;
          radius = a.radius;
        }
      }
    }
  });

  it('refuses a fan it cannot describe', () => {
    expect(dockAnchors([], 130, 400, PEAK, MIN)).toBeNull();
    expect(dockAnchors([10, 20], 0, 400, PEAK, MIN)).toBeNull();
    expect(dockAnchors([10, 10], 130, 400, PEAK, MIN)).toBeNull();
  });
});

describe('dockPlacements', () => {
  /*
   * ⭐ A POINTER NOWHERE NEAR THE FAN LEAVES IT EXACTLY AS IT RESTS, WHICH IS
   * NEW AND IS THE WHOLE POINT OF LOCAL SEPARATION. Under cut two the strip
   * stayed spread whatever the pointer did - separation was a property of being
   * docked, not of being magnified - and that permanent spread is what the peak
   * could not then afford.
   */
  it('leaves the fan completely at rest when the pointer is nowhere near it', () => {
    const a = fan(5, 130, 117, 308);
    dockPlacements(a, (a.lefts[0] as number) - 10 * a.advance).forEach((p) => {
      expect(p.scale).toBe(1);
      expect(p.shift).toBe(0);
      expect(p.bump).toBe(0);
    });
  });

  it('reaches the full peak with the pointer on a card centre', () => {
    const a = fan(5, 130, 117, 308);
    const centre = (a.lefts[2] as number) + a.width / 2;
    const at = dockPlacements(a, centre)[2] as { scale: number; bump: number };
    expect(at.scale).toBeCloseTo(a.peak, 9);
    expect(at.bump).toBeCloseTo(1, 9);
  });

  it('reports a falloff the scale agrees with, so the shadow tracks the size', () => {
    const a = fan(6, 130, 117, 191);
    for (const x of sweep(a)) {
      for (const p of dockPlacements(a, x)) {
        const tallest = Math.max(...dockPlacements(a, x).map((q) => q.bump));
        const depth = (1 - a.min) * tallest;
        expect(p.scale).toBeCloseTo(1 - depth + (a.peak - 1 + depth) * p.bump, 9);
      }
    }
  });

  it('is a pure function of the pointer: the same x twice gives the same answer', () => {
    const a = fan(6, 130, 117, 191);
    for (const x of sweep(a)) {
      expect(dockPlacements(a, x)).toEqual(dockPlacements(a, x));
    }
  });

  /*
   * ⭐ THE PROPERTY THE FEATURE EXISTS FOR. Every gap is the fan's own resting
   * overlap, opened towards the printed gap by exactly how far the wave has
   * reached it. So the strip is a fan at the ends and a dock in the middle, and
   * it is one continuous thing rather than two glued together.
   */
  it('opens each gap by exactly as much as the wave has reached it', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      const step = a.spacing - a.advance;
      let worst = 0;
      for (const x of sweep(a)) {
        const b = boxes(a, x);
        const open = openings(a, x);
        for (let i = 0; i < b.length - 1; i++) {
          const want = a.advance - a.width + step * (open[i] as number);
          const got = (b[i + 1] as { left: number }).left - (b[i] as { right: number }).right;
          worst = Math.max(worst, Math.abs(got - want));
        }
      }
      expect(worst, s.name).toBeLessThan(1e-6);
    }
  });

  /*
   * ⭐ AND THE PROPERTY THAT REPLACES CUT TWO'S. Not "nothing overlaps" - the
   * tail is a fan and laps by design - but NOTHING THAT IS GROWING OVERLAPS.
   * Wherever a gap's wave has arrived in full, the two cards stand clear with
   * the printed gap between them, whatever they are scaled to.
   */
  it('leaves no overlap at all wherever the wave has reached a gap', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      if (a.overlapped) continue;
      let tightest = Infinity;
      for (const x of sweep(a)) {
        const b = boxes(a, x);
        const open = openings(a, x);
        for (let i = 0; i < b.length - 1; i++) {
          if ((open[i] as number) < 1 - 1e-9) continue;
          const gap = (b[i + 1] as { left: number }).left - (b[i] as { right: number }).right;
          tightest = Math.min(tightest, gap);
        }
      }
      // `Infinity` is the shapes with no magnifier at all, which have no wave
      // to have reached anything - `overlapped` is not the only such case.
      if (tightest !== Infinity) expect(tightest, s.name).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  /*
   * ⚠️ THE CARD UNDER THE POINTER IS THE ONE THAT MUST BE WHOLE, and it is
   * worth pinning separately from the sweep above because it is the promise a
   * player actually experiences. Its own falloff is 1, so both of its gaps are
   * fully open by construction - this is what notices if `DOCK_OPEN_GAIN` or
   * the `max` in `opening` is ever changed in a way that breaks that.
   */
  it('stands the hovered card clear of both its neighbours', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      if (a.overlapped || a.peak <= 1) continue;
      for (let i = 0; i < s.n; i++) {
        const b = boxes(a, (a.lefts[i] as number) + a.width / 2);
        const left = b[i - 1];
        const right = b[i + 1];
        const here = b[i] as { left: number; right: number };
        if (left) expect(here.left - left.right, `${s.name} #${i}`).toBeGreaterThanOrEqual(-1e-9);
        if (right) expect(right.left - here.right, `${s.name} #${i}`).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('pins the fan to its resting left edge, so it can never reach the rail', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      let worst = 0;
      for (const x of sweep(a)) {
        const left = (boxes(a, x)[0] as { left: number }).left;
        worst = Math.max(worst, Math.abs(left - (a.lefts[0] as number)));
      }
      expect(worst, s.name).toBeLessThan(1e-9);
    }
  });

  it('keeps the wave and its gaps inside the budget the row measured', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      const restRight = (a.lefts.at(-1) as number) + a.width;
      let over = 0;
      for (const x of sweep(a)) {
        const right = (boxes(a, x).at(-1) as { right: number }).right;
        const total =
          dockSpread(a.lefts, a.width, a.advance, a.min, a.peak, a.radius, x) +
          dockOpening(a.lefts, a.width, a.advance, a.spacing, a.radius, x);
        over = Math.max(over, right - restRight - s.budget, total - s.budget);
      }
      expect(over, s.name).toBeLessThanOrEqual(1e-6);
    }
  });

  /*
   * ⚠️ THE OSCILLATION GUARD, AS A NUMBER. Jitter is a discontinuity: a pointer
   * step of half a pixel that moves a card by a lot. The dock's field is smooth
   * by construction, and this is what would fail if somebody re-derived it from
   * the live, already-transformed positions - the card boundaries are where the
   * feedback loop bites, and the sweep crosses every one of them.
   *
   * ⚠️ THE `min` IN `opening` PUTS A KINK IN THE FIELD, NOT A JUMP. A gap that
   * reaches full and stays there has a discontinuous derivative at that point,
   * which is invisible; what this rules out is a discontinuous VALUE, and half
   * a pixel of pointer travel is the resolution a mouse actually delivers.
   */
  it('moves smoothly across every card boundary, with no jump', () => {
    for (const s of SHAPES) {
      const a = fan(s.n, s.width, s.advance, s.budget);
      const xs = sweep(a);
      // Carried rather than recomputed: the sweep is long and each x would
      // otherwise be placed twice, once as an "after" and once as a "before".
      let before = dockPlacements(a, xs[0] as number);
      let jumpShift = 0;
      let jumpScale = 0;
      for (let k = 1; k < xs.length; k++) {
        const after = dockPlacements(a, xs[k] as number);
        for (let i = 0; i < before.length; i++) {
          const b = before[i] as { scale: number; shift: number };
          const c = after[i] as { scale: number; shift: number };
          jumpShift = Math.max(jumpShift, Math.abs(c.shift - b.shift));
          jumpScale = Math.max(jumpScale, Math.abs(c.scale - b.scale));
        }
        before = after;
      }
      // Half a pixel of pointer travel, at most two pixels of card travel.
      expect(jumpShift, s.name).toBeLessThan(2);
      expect(jumpScale, s.name).toBeLessThan(0.03);
    }
  });

  /*
   * ⭐ WHERE THE WIDTH COMES FROM, AS AN ASSERTION. A card further than the
   * radius from the pointer has no falloff at all, so with the wave at full
   * height it sits at exactly `min` - not near it, at it, because the raised
   * cosine has compact support. That is the pixels the peak is spending.
   */
  it('shrinks every card outside the radius to exactly the trough', () => {
    const a = fan(6, 88, 79, 302);
    const far = dockPlacements(a, (a.lefts[0] as number) + a.width / 2);
    const outside = Math.ceil(a.radius);
    for (let i = outside; i < far.length; i++) {
      expect((far[i] as { scale: number }).scale).toBeCloseTo(a.min, 9);
    }
  });
});

/*
 * THE RISE. The strip may lift clear of the barn before it spends the barn's
 * column, so the barn is never covered - and it stops at the farm panel's top
 * edge, which is what keeps it off the turn bar outside the panel above.
 */
describe('dockRise', () => {
  it('rises exactly far enough to clear the top of the barn', () => {
    // Desktop step, measured: card top 618.7, height 93.8, barn top 602,
    // farm panel top 464. The lift is the whole strip's height.
    const rise = dockRise(618.7, 93.8, 602, 464, PEAK);
    expect(rise.clear).toBe(true);
    expect(rise.lift).toBeCloseTo(110.5, 6);
  });

  /*
   * ⚠️ AND THE LIFT IS WHY THE STRIP NOW USUALLY STAYS DOWN. 154.7px of
   * headroom, 110.5 of it spent rising: 44.2 left over a 93.8px card caps the
   * peak at 1.47, against the 2.65 the same headroom carries at home. Under the
   * order this file pins, `dockBeats` takes the 2.65 - which is why the desktop
   * step stopped covering its own tableau every time a pointer crossed the hand.
   */
  it('charges the lift to the peak, because the two share the headroom', () => {
    const rise = dockRise(618.7, 93.8, 602, 464, PEAK);
    expect(rise.peak).toBeCloseTo(1 + 44.2 / 93.8, 4);
    // At home the same headroom carries 2.65, so the token is what binds.
    expect(rise.homePeak).toBeCloseTo(PEAK, 6);
  });

  it('stays down, rather than half way, when the ceiling will not carry it', () => {
    // 40px of headroom against a 90px lift. Half a lift still covers the barn.
    // The headroom is one whole card, so it carries a doubling and no more.
    const rise = dockRise(140, 40, 90, 100, PEAK);
    expect(rise.clear).toBe(false);
    expect(rise.lift).toBe(0);
    expect(rise.peak).toBeCloseTo(2, 6);
  });

  it('caps the peak even with the strip at home, so it cannot leave the panel', () => {
    // 20px of headroom over a 100px card buys a fifth of a card of growth.
    const rise = dockRise(120, 100, 220, 100, PEAK);
    expect(rise.lift).toBe(0);
    expect(rise.homePeak).toBeCloseTo(1.2, 6);
  });

  it('needs no lift at all when there is no barn beside the row', () => {
    // `barnTop` at the card's own bottom edge is how the caller says "nothing
    // to rise over" - the row already owns its column.
    const rise = dockRise(200, 60, 260, 100, PEAK);
    expect(rise.clear).toBe(true);
    expect(rise.lift).toBe(0);
  });
});

/*
 * ⭐ THE CONCESSION ORDER AS A COMPARISON. The hook fits the dock to the hand's
 * own row and to the whole column it could reach by rising, and this picks.
 */
describe('dockBeats', () => {
  const at = (spacing: number, radius: number, peak: number): DockAnchors => ({
    lefts: [0, 100],
    width: 100,
    advance: 100,
    spacing,
    radius,
    peak,
    min: 1,
    overlapped: spacing < 100,
  });

  it('takes the taller wave over everything else', () => {
    expect(dockBeats(at(103, 1.4, 2.3), at(96, 3, 1.5))).toBe(true);
    expect(dockBeats(at(103, 3, 1.5), at(103, 1.4, 2.3))).toBe(false);
  });

  it('takes the wider separation when the peak ties', () => {
    expect(dockBeats(at(103, 1.4, 2.3), at(98, 3, 2.3))).toBe(true);
  });

  it('gives up the falloff last', () => {
    expect(dockBeats(at(103, 3, 2.3), at(103, 1.4, 2.3))).toBe(true);
    expect(dockBeats(at(103, 1.4, 2.3), at(103, 3, 2.3))).toBe(false);
  });

  /*
   * ⚠️ AND THE ONE EXCEPTION, WHICH IS NOT A SOFTENING OF THE ORDER. A falloff
   * at peak 1 draws nothing, so width spent on it is width spent on nothing -
   * it cannot beat a narrow falloff that still magnifies. The peak test above
   * catches this on its own now, but it is kept because it is the case a future
   * re-ordering would break first.
   */
  it('will not trade a live wave for a wide falloff with no peak in it', () => {
    expect(dockBeats(at(103, 3, 1), at(103, 1.4, 1.4))).toBe(false);
    expect(dockBeats(at(103, 1.4, 1.4), at(103, 3, 1))).toBe(true);
  });
});
