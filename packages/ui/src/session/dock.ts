/**
 * Dock magnification, wired to the hand: the DOM half of `view/dock.ts`.
 *
 * The card under the pointer grows, its neighbours grow less, and the whole
 * strip lifts out of its row and spreads until nothing overlaps anything. The
 * arithmetic is next door and is tested there; what lives here is the part that
 * can only be got wrong against a real layout.
 *
 * ⭐ THE ONE RULE THAT KEEPS IT FROM BUZZING: EVERY MAGNIFICATION IS COMPUTED
 * FROM THE RESTING GEOMETRY, NEVER FROM WHERE THE CARDS ARE NOW.
 *
 * That is the classic dock bug and it is worth stating the loop out loud, since
 * the obvious implementation walks straight into it. Magnify from the live
 * positions and the growth moves the cards, which changes which card is under
 * the pointer, which changes the growth - so the fan sits at a card boundary
 * and flickers between two answers, worst exactly where a player's pointer
 * spends its time. Here the anchors are measured once, with the transforms
 * switched off (see `measure`), and re-measured only when the layout itself
 * changes. Between those, everything on screen is a pure function of one
 * number, the pointer's x, and a pure function cannot oscillate.
 *
 * ⭐ THE STRIP MAY FLOAT, AND SINCE THE THIRD CUT IT OFTEN DECLINES TO.
 *
 * On hover the strip can LIFT out of the row, clear of the top of the barn
 * beside it, and spread across the farm's whole left column - the barn's column
 * included, because it is then above it rather than through it. That is the
 * width trade: 716px of hand row becomes 906px of column at 1600x900.
 *
 * ⚠️ IT IS NOW A CHOICE RATHER THAN A HABIT, AND THAT IS THE VISIBLE HALF OF
 * THE 27/08 RE-CUT. Rising spends headroom, the growth spends the same
 * headroom, and the PEAK now outranks the width that rising buys
 * (`view/dock.ts`, `dockBeats`). So a strip that would have to flatten its wave
 * to get over the barn stays in its row - where before it rose 122px every time
 * a pointer crossed the hand, covered the whole tableau, and bought width it
 * could not then afford to spend on anything you could see.
 *
 *  - **The barn is never covered.** The lift is exactly the distance from the
 *    resting card's bottom edge to the top of the barn strip, and if the
 *    headroom will not stretch to the whole of it the column is handed straight
 *    back and the strip keeps to its own row (`dockRise().clear`). Structural,
 *    not a number somebody has to re-check.
 *  - **The reading region is never covered.** It is the farm's other column and
 *    the budget stops at the seam between them. It is showing the very card
 *    under the pointer, so covering it would be self-defeating.
 *  - **Upward is over your own farm**, and the ceiling is the farm panel's own
 *    top edge - the tableau and the farm's head bar are both inside it and are
 *    both coverable while a pointer is on your hand. The turn bar is not: it
 *    sits OUTSIDE the panel, above it, so stopping at the panel's edge keeps
 *    the strip off it by construction.
 *  - **Rising costs peak, and the peak is what it was rising to buy.** The lift
 *    and the growth reach into the same headroom, so what the ceiling leaves
 *    after the lift caps the peak. `dockBeats` fits the dock to both budgets
 *    and takes whichever ends up with the taller wave, so the strip leaves its
 *    row only when the extra width is worth more than the headroom it costs.
 *
 * ⚠️ THE LIFT DOES NOT MOVE THE HIT TARGETS, AND THAT IS DELIBERATE. It is a
 * transform on the inner `.card`; the `.hand-card` slot keeps its resting box.
 * So a click lands whether it is aimed at the floating card (a descendant of
 * the slot, so it bubbles to the same handler) or at the space the card left
 * behind, and `pointerleave` on `.hand` does not fire while the pointer is on a
 * lifted card, because the card is still inside the hand in the DOM even when
 * it is above it on the screen.
 *
 * The one thing that still tracks the live boxes is the browser's own `:hover`,
 * which raises the card you are actually pointing at (`z-index: 50`, shipped
 * long before this). That is deliberate: what you press should be what you see.
 * It cannot start the loop either, because nothing here reads it.
 *
 * ⚠️ SUPPRESSED FOR THE WHOLE OF A DRAG, and the reasoning cuts the other way
 * for a HELD card, so the two are not the same decision:
 *
 *  - **A drag in flight turns it off.** The pointer crosses the fan on its way
 *    to the tableau and to the rail, the ghost is already under it, and cards
 *    blowing up beneath a card in flight is noise on top of the one gesture in
 *    this interface that needs a steady hand. It also removes any question
 *    about a press landing on a card that moved: the fan is at rest before the
 *    drag is armed and stays there until it ends.
 *  - **A held card leaves it on.** Holding is a SELECTION, not a gesture - the
 *    card is lifted out of the fan and the table's destinations light up, and a
 *    player may sit in that state for a while, quite reasonably browsing the
 *    rest of the hand to reconsider. Freezing the fan then would be freezing it
 *    for the exact stretch of time it is most likely to be read. `.is-held`
 *    lifts the SLOT and the dock transforms the CARD inside it, so the two
 *    compose rather than fight.
 *
 * A press that has not yet travelled the drag threshold is still a click, so
 * the fan is live for those first six pixels. That is intended: it is a click,
 * and a click on a hand card should behave exactly as it did before.
 */

import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { SCALE_EVENT } from '../components/UiScale';
import { dockAnchors, dockBeats, dockPlacements, dockRise } from '../view/dock';
import type { DockAnchors } from '../view/dock';

/** Shortens the follow while the pointer is tracking; the settle keeps the longer one. */
const LIVE = 'dock-live';

/** Transforms and transition off for the length of a measurement. */
const STILL = 'dock-still';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Below this the lift is not worth asking for, and rounding is not a decision. */
const LIFT_SLACK = 0.5;

/**
 * Magnify the hand fan under the pointer. Returns the ref to put on `.hand`.
 *
 * `handKey` exists so the anchors are re-measured when the hand's CONTENTS
 * change and not merely when its box does: drawing a card changes how many
 * slots share the row and therefore every resting position, and a
 * `ResizeObserver` on a row that was already full would not fire.
 */
export function useHandDock(handKey: string, enabled: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  // A layout effect, not an effect: a re-render can hand back a recycled slot
  // still carrying the last frame's properties, and clearing those after the
  // paint would show one frame of a card magnified for no reason.
  useLayoutEffect(() => {
    const hand = ref.current;
    if (!hand) return;

    const motion = window.matchMedia(REDUCED);
    let cards: HTMLElement[] = [];
    let anchors: DockAnchors | null = null;
    let lift = 0;
    let pointer: number | null = null;
    let focused: number | null = null;
    let frame = 0;

    const clear = () => {
      hand.style.removeProperty('--dock-y');
      for (const el of cards) {
        el.style.removeProperty('--dock-x');
        el.style.removeProperty('--dock-s');
        el.style.removeProperty('--dock-b');
      }
    };

    /**
     * Read the fan at rest, and work out how much of a dock this row can pay for.
     *
     * ⚠️ THE `STILL` CLASS IS LOAD-BEARING, NOT TIDINESS. Clearing the custom
     * properties retargets the transition rather than ending it, so a rect read
     * a moment after leaving the hand would be a rect somewhere mid-flight -
     * and the anchors would be measured off a lie. `STILL` takes the transition
     * out for the one synchronous read, which `getBoundingClientRect` forces.
     */
    const measure = () => {
      cards = [...hand.querySelectorAll<HTMLElement>('.hand-card')];
      anchors = null;
      lift = 0;
      if (!enabled || motion.matches || cards.length === 0) {
        clear();
        return;
      }
      hand.classList.add(STILL);
      clear();
      const printed = cards.map((el) => (el.querySelector('.card') ?? el).getBoundingClientRect());
      const row = hand.getBoundingClientRect();
      const farm = hand.closest('.farm');
      const stripsEl = hand.closest('.farm-strips');
      const strips = stripsEl?.getBoundingClientRect() ?? null;
      const barn = stripsEl?.querySelector('.barn')?.getBoundingClientRect() ?? null;
      const tableau = farm?.querySelector('.tableau')?.getBoundingClientRect() ?? null;
      hand.classList.remove(STILL);
      const box = printed[0];
      const width = box?.width ?? 0;
      const restRight = printed.at(-1)?.right ?? 0;
      if (!box || !(width > 0)) return;
      const style = getComputedStyle(hand);
      const token = Number.parseFloat(style.getPropertyValue('--dock-peak'));
      const peak = Number.isFinite(token) ? token : 1;
      // How far a card away from the wave shrinks. This is what PAYS for the
      // peak - see the header of `view/dock.ts` - so it is read here and passed
      // straight through rather than being fitted to anything.
      const floor = Number.parseFloat(style.getPropertyValue('--dock-min'));
      const min = Number.isFinite(floor) ? floor : 1;

      /*
       * ⭐ WHAT THE STRIP IS ALLOWED TO SPEND, AND WHAT IT PAYS FOR IT.
       *
       * Two budgets, and the dock is fitted to both. HOME is the empty end of
       * the hand's own row. RISEN is everything out to the right-hand edge of
       * the farm's LEFT COLUMN - the barn's column included, past which is only
       * the reading region - and it costs a lift over the top of the barn, paid
       * for out of the headroom, and therefore paid for in PEAK, because a
       * magnified card grows upward into the same space (`dockRise`).
       *
       * `dockBeats` then picks, in the concession order: separation first, then
       * falloff, then peak. So the strip leaves its row exactly when leaving it
       * buys something the order says is worth more than the peak it costs, and
       * a hand its own row can already hold apart stays put.
       *
       * ⚠️ THE PEAK CAP APPLIES TO BOTH BRANCHES, not only to the risen one.
       * Even a strip that stays home grows upward, and the ceiling is what
       * keeps it inside the farm panel and away from the turn bar above it.
       */
      const ceiling = farm?.getBoundingClientRect().top ?? tableau?.top ?? box.top;
      const rise = dockRise(box.top, box.height, barn?.top ?? box.bottom, ceiling, peak);
      const spot = (edge: number, cap: number) =>
        dockAnchors(
          printed.map((b) => b.left),
          width,
          Math.max(0, edge - restRight),
          cap,
          min,
        );

      const home = spot(row.right, rise.homePeak);
      const risen = rise.clear ? spot(strips?.right ?? row.right, rise.peak) : null;

      const up = home !== null && risen !== null ? dockBeats(risen, home) : risen !== null;
      anchors = up ? risen : home;
      // No lift when the dock has nothing to draw: a strip that neither
      // separates nor moves has no business leaving its row.
      const inert =
        !anchors ||
        (anchors.peak <= 1 && anchors.min >= 1 && anchors.spacing <= anchors.advance + LIFT_SLACK);
      lift = up && !inert ? rise.lift : 0;
    };

    const draw = () => {
      frame = 0;
      if (!anchors) return;
      const at = pointer ?? focused;
      if (at === null) {
        clear();
        return;
      }
      // One property for the whole strip, inherited down: every card rises by
      // the same amount, so writing it per card would be the same string n times.
      const y = lift > 0 ? `${(-lift).toFixed(2)}px` : '0px';
      if (hand.style.getPropertyValue('--dock-y') !== y) hand.style.setProperty('--dock-y', y);
      const places = dockPlacements(anchors, at);
      for (let i = 0; i < cards.length; i++) {
        const el = cards[i];
        const place = places[i];
        if (!el || !place) continue;
        // Written only when the string actually changes, so a pointer moving
        // along a card that is already at 1.000 costs no style invalidation.
        const s = place.scale.toFixed(4);
        const x = `${place.shift.toFixed(2)}px`;
        // The falloff itself, for the elevation to follow. Coarser than the
        // scale on purpose: a shadow is a blur, and three decimals of one are
        // three style invalidations a frame that nothing on screen can show.
        const b = place.bump.toFixed(3);
        if (el.style.getPropertyValue('--dock-s') !== s) el.style.setProperty('--dock-s', s);
        if (el.style.getPropertyValue('--dock-x') !== x) el.style.setProperty('--dock-x', x);
        if (el.style.getPropertyValue('--dock-b') !== b) el.style.setProperty('--dock-b', b);
      }
    };

    /** One write per animation frame, however many moves arrive inside it. */
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    /*
     * ⚠️ RE-MEASURED ON THE WAY IN, AND IT IS NOT BELT AND BRACES.
     *
     * The `ResizeObserver` watches the hand's own BOX, so it misses every
     * change that moves the row without resizing it - a building added above,
     * a barn pile appearing beside it, a web font swapping under the strip
     * title. None of those touch `.hand`'s width or height, and all of them
     * move the distance between the fan and the top of the barn, which is the
     * whole of the lift. A stale lift by two pixels is two pixels of barn
     * covered, and the barn is the thing this promised never to cover.
     *
     * ⚠️ IT DOES NOT REOPEN THE OSCILLATION LOOP, and the reason is the event
     * it is on. ENTER fires once per hover, before any transform is written and
     * with the strip at rest; MOVE never measures anything. So the field is
     * still a pure function of the pointer's x for the whole of a hover, which
     * is the property that makes buzzing impossible.
     */
    const onEnter = () => {
      measure();
      schedule();
    };

    const onMove = (e: PointerEvent) => {
      pointer = e.clientX;
      hand.classList.add(LIVE);
      schedule();
    };

    const onLeave = () => {
      pointer = null;
      // Dropping `LIVE` hands the settle back to the longer duration, so the fan
      // eases home rather than snapping the moment you leave it.
      hand.classList.remove(LIVE);
      schedule();
    };

    /*
     * Keyboard parity. The hand is tabbable and focus already feeds the reading
     * region, so a focused card magnifies exactly as a hovered one does - and
     * `:focus-visible` rather than `:focus` is what stops a card that was
     * merely clicked from holding the fan open after the pointer has gone.
     */
    const onFocusIn = (e: FocusEvent) => {
      // Tabbing in is the keyboard's ENTER, so it re-reads for the same reason.
      measure();
      const el = (e.target as Element | null)?.closest?.('.hand-card') ?? null;
      const i = el instanceof HTMLElement ? cards.indexOf(el) : -1;
      const left = i >= 0 ? anchors?.lefts[i] : undefined;
      const visible = el instanceof HTMLElement && el.matches(':focus-visible');
      focused = visible && left !== undefined && anchors ? left + anchors.width / 2 : null;
      schedule();
    };

    const onFocusOut = () => {
      focused = null;
      schedule();
    };

    const remeasure = () => {
      measure();
      schedule();
    };

    measure();
    hand.addEventListener('pointerenter', onEnter);
    hand.addEventListener('pointermove', onMove);
    hand.addEventListener('pointerleave', onLeave);
    hand.addEventListener('focusin', onFocusIn);
    hand.addEventListener('focusout', onFocusOut);
    // The row's width moves with the barn beside it, the rail, and the size
    // ladder; the two window listeners catch the cases where the tokens change
    // under a box that did not (the scale slider, in particular).
    const resize = new ResizeObserver(remeasure);
    resize.observe(hand);
    window.addEventListener('resize', remeasure);
    window.addEventListener(SCALE_EVENT, remeasure);
    motion.addEventListener('change', remeasure);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      hand.removeEventListener('pointerenter', onEnter);
      hand.removeEventListener('pointermove', onMove);
      hand.removeEventListener('pointerleave', onLeave);
      hand.removeEventListener('focusin', onFocusIn);
      hand.removeEventListener('focusout', onFocusOut);
      resize.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener(SCALE_EVENT, remeasure);
      motion.removeEventListener('change', remeasure);
      hand.classList.remove(LIVE, STILL);
      clear();
    };
  }, [handKey, enabled]);

  return ref;
}
