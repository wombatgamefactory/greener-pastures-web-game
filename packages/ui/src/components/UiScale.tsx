/**
 * ⭐ THE UI SCALE SLIDER (phase 5): one multiplier over the responsive step.
 *
 * The published digital-board-game guidance is explicit that this should not
 * exist - design for 100% and trust browser zoom. The market disagreed loudly
 * enough to be worth listening to: Ark Nova shipped one and its own release
 * notes call it one of the most requested features. It is cheap insurance
 * against a screen we have not sat in front of, and it is reversible.
 *
 * ⚠️ AT SCALE 1 NOTHING HAPPENS AT ALL, and that is the hard constraint this
 * file is shaped around. Not "nothing visible" - literally no declaration is
 * written, `document.documentElement` carries no inline style, and every token
 * resolves out of `base.css` exactly as it did before this file existed. That
 * is why `measure-ui` at scale 1 reports the same numbers as it did in phase 4,
 * and it is checked by that rather than asserted here.
 *
 * ⚠️ IT MULTIPLIES THE STEP; IT NEVER REPLACES IT. The tempting implementation
 * is to write the scaled sizes once and forget them, and it is wrong: the
 * responsive steps in `base.css` are load-bearing decisions (the floor gives up
 * the reading region entirely, and grows its building cards to do it), and a
 * slider that pinned a size would quietly turn into a second, worse way to
 * choose a breakpoint. So every application starts by CLEARING the overrides
 * and re-reading what the stylesheet says at the current viewport, and the
 * resize listener does the same. The slider can make the current step bigger or
 * smaller. It cannot make it a different step.
 *
 * `--card-read` scaling to zero at the floor is the property that shows this
 * works: 0 means "this step has no room for a reading region", 0 x anything is
 * still 0, and the region stays off rather than reappearing at 200px.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * The size tokens the slider multiplies - every one `base.css` dials per step,
 * and nothing else.
 *
 * ⚠️ IT IS DELIBERATELY NOT "EVERY CUSTOM PROPERTY". Font sizes inside
 * components, padding, the 40px hit targets and the card's own container-query
 * type all stay put, because the four card widths here are what every one of
 * those is derived from: a `.card` sets its text in `cqw`, so scaling the card
 * scales its type, and the tableau's capacity follows the building width. A
 * blanket scale over everything would double-count all of it.
 */
const SCALED = [
  '--rail-w',
  '--card-building',
  '--card-hand',
  '--card-deck',
  '--card-inspector',
  '--island-tile-w',
  '--gap',
  '--farm-title',
  '--card-read',
] as const;

const KEY = 'gp.ui-scale';
/**
 * ⭐ 80% TO 120%, AND THE CEILING IS MEASURED RATHER THAN CHOSEN.
 *
 * Phases 0 to 4 spent every pixel of slack on this screen deliberately, so
 * there is nothing left for a scale-up to grow into and the ceiling is a real
 * cliff rather than a taste. Driven at all three viewports on the worst-case
 * fixture, watching `slicedBuildings` and whether any landmark leaves the
 * window:
 *
 *   80-100%   nothing scrolls, nothing is cut. Shrinking is free.
 *   105-120%  the TABLEAU scrolls, and its bottom row is partly hidden - 4 of
 *             10 buildings at 105% on the floor, 5 or 6 at 120% everywhere.
 *             Nothing leaves the window.
 *   125%+     THE ISLAND RUNS OFF THE RIGHT EDGE at 1366 and 1600. An
 *             `.island-row` is a flex row that does not wrap and the page never
 *             scrolls, so a too-wide island is simply cut off with no way to
 *             get at it. That is not a trade, it is a broken screen.
 *
 * So the maximum is the last value that keeps every landmark on screen. The
 * band above 100% is still honest rather than free: it BUYS CARD SIZE WITH
 * TABLEAU ROWS, which is precisely the trade phase 1 refused to make on every
 * player's behalf and is a perfectly reasonable one for a player to make for
 * themselves. It is survivable because the tableau already scrolls and already
 * carries phase 1's scroll-cue fade, so the rows that go are signposted rather
 * than sliced. Nothing new had to be built for it.
 *
 * ⚠️ The floor's cliff is one notch lower than the other two steps (105%, not
 * 110%), which is expected: phase 4 spent the floor's remaining slack on bigger
 * building cards, so it is the step with the least left.
 */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.2;
const STEP = 0.05;

/**
 * `Table.tsx` reads these same tokens back with `getComputedStyle` and caches
 * them in React state, so it has to be told when they move. It cannot simply
 * listen to `resize`: React runs child effects before parent ones, so the
 * table's resize listener is registered - and therefore fires - BEFORE the one
 * that re-applies the scale, and would read the previous step's scaled value.
 *
 * So `applyScale` announces itself, synchronously, once the new values are in
 * place.
 * Both listeners run in the same task and React batches the two state updates
 * into one render, so there is no intermediate frame at the wrong size.
 */
export const SCALE_EVENT = 'gp:uiscale';

function clamp(n: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
}

function stored(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const n = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    // Private browsing and locked-down profiles both throw on access rather
    // than returning null. A preference nobody can save is not an error.
    return 1;
  }
}

function applyScale(scale: number): void {
  const root = document.documentElement;
  // ALWAYS clear first. This is what makes the read below see the stylesheet's
  // value for the CURRENT viewport rather than the last one we wrote over it,
  // and it is the whole of "multiplies the step, never replaces it".
  for (const name of SCALED) root.style.removeProperty(name);
  if (scale !== 1) {
    const base = window.getComputedStyle(root);
    // Read every value before writing any of them: writing as we go would make
    // each token's base value depend on whether an earlier one had been scaled,
    // if a token is ever defined in terms of another.
    const px = SCALED.map((name) => Number.parseFloat(base.getPropertyValue(name)));
    SCALED.forEach((name, i) => {
      const value = px[i];
      if (value === undefined || !Number.isFinite(value)) return;
      root.style.setProperty(name, `${Math.round(value * scale)}px`);
    });
  }
  window.dispatchEvent(new Event(SCALE_EVENT));
}

export interface UiScale {
  readonly scale: number;
  set(next: number): void;
}

export function useUiScale(): UiScale {
  const [scale, setScale] = useState(stored);

  useEffect(() => {
    applyScale(scale);
    // The step can change under us without the scale changing, so a resize has
    // to re-derive from the new step rather than keep the pixels we wrote.
    const onResize = () => applyScale(scale);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scale]);

  const set = useCallback((next: number) => {
    const value = clamp(next);
    setScale(value);
    try {
      window.localStorage.setItem(KEY, String(value));
    } catch {
      /* nothing to do: the preference simply does not survive the session */
    }
  }, []);

  return { scale, set };
}

/**
 * The control, in `.rail-foot` beside the pace strip.
 *
 * It is a slider rather than the ghost-button group the pace uses because the
 * two are different kinds of choice: pace is three named speeds, size is a
 * continuum, and a player who wants 115% should not have to pick between 110
 * and 120. The percentage is printed because a slider with no readout cannot be
 * put back exactly where it was.
 *
 * `accent-color` recolours the native track and thumb, which on most platforms
 * default to the system blue - and this palette has no blue in it and is not
 * gaining one. Sepia, like everything else.
 */
export function UiScaleControl({ ui }: { ui: UiScale }) {
  const percent = Math.round(ui.scale * 100);
  return (
    <label className="uiscale" title="Scale the whole interface">
      <span className="visually-hidden">interface size</span>
      <input
        type="range"
        min={Math.round(SCALE_MIN * 100)}
        max={Math.round(SCALE_MAX * 100)}
        step={Math.round(STEP * 100)}
        value={percent}
        onChange={(e) => ui.set(Number.parseInt(e.target.value, 10) / 100)}
      />
      <b>{percent}%</b>
    </label>
  );
}
