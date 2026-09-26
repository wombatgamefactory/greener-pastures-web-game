/**
 * The WAI-ARIA "roving tabindex" pattern for a one-dimensional row of cards.
 *
 * Moved out of `Farm.tsx` (25/09/2026, item 4 of the WP1b layout pass) so
 * `RivalRail.tsx` can share the exact same behaviour for its Notice Board
 * buttons rather than re-implementing it: a keyboard user should not learn a
 * second set of arrow-key rules for the second row of cards on the table.
 *
 * B19, 25/09/2026 (the original note, kept verbatim from `Farm.tsx`):
 *
 * Before this, only a LIVE building or hand card carried a `tabIndex` at all
 * (`tabIndex={live ? 0 : undefined}`), so a keyboard user landing on the
 * tableau or the hand could reach the cards they could act on and nothing
 * else - reading what a rival has built, or what is in a hand between turns,
 * was mouse-and-hover only (the appraisal's accessibility finding: "non-live
 * buildings and hand cards are not focusable, so a keyboard user cannot read a
 * card").
 *
 * Every card in the group is now reachable, but only ONE at a time sits in the
 * page's Tab order (the WAI-ARIA "roving tabindex" pattern for a
 * one-dimensional widget): Tab moves past the whole row in one stop, and the
 * arrow keys move which card is current, same as a native `<select>` or a
 * radio group. Activation is untouched by any of this - it still only exists
 * on a live card, gated where it always was by each caller's own
 * `onClick`/Enter-Space handling.
 */

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export function useRovingTabIndex(length: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const activeIndex = length > 0 ? Math.min(active, length - 1) : 0;
  const setRef = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
  const focusIndex = (i: number) => {
    if (length === 0) return;
    const clamped = Math.max(0, Math.min(length - 1, i));
    setActive(clamped);
    refs.current[clamped]?.focus();
  };
  const onKeyDown = (i: number) => (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusIndex(i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusIndex(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusIndex(0);
        break;
      case 'End':
        e.preventDefault();
        focusIndex(length - 1);
        break;
      default:
        break;
    }
  };
  return { activeIndex, setRef, onKeyDown, setActive };
}
