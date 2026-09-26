/**
 * "While you were away" (B9, 25/09/2026).
 *
 * The appraisal's B9: when the decision returns to you after a run of bot
 * turns, say what happened in player words before you act on top of it. The
 * lines themselves are built by `session/narrate.ts`'s `summariseTurns`
 * (unit-tested there); this component only lays them out, handles dismissal,
 * and stays out of the way of anything still clickable.
 *
 * PLACEMENT: a slim strip pinned to the bottom of the viewport rather than a
 * modal or a corner card. `Table.tsx` already reserves the TOP of the main
 * column for `.turn-zone`'s docked prompt (B3), the rail runs down the LEFT,
 * and the shared table plus your own farm fill the rest - there is no safe
 * fixed corner across every viewport this project targets, but the strip of
 * dead space at the very bottom of the page is clear at all of them.
 * `tools/verify-motion.mjs` proves this with a real hit-test against the
 * decks, the rival boards and the hand, rather than trusting the layout to
 * hold by inspection.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Suit } from '@gp/data';

import { useEscapeKey } from '../session/escape';
import type { TurnSummaryLine } from '../session/narrate';
import { SUIT_META } from '../view/suits';

export function TurnSummary({
  lines,
  onDismiss,
}: {
  /** Null (or empty) renders nothing - `App.tsx` clears this once shown. */
  lines: readonly TurnSummaryLine[] | null;
  onDismiss: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const shown = lines !== null && lines.length > 0;

  // Move focus to the close button the moment the strip appears, so Escape
  // works immediately without a player having to tab to find it, and give it
  // back to whatever had focus before (usually nothing in particular, since
  // this appears while a bot round is playing, but never assume) on dismiss.
  useEffect(() => {
    if (!shown) return;
    restoreFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      restoreFocusTo.current?.focus();
    };
  }, [shown]);

  // 25/09/2026 (WP5 item 3): this used to be a plain `window` BUBBLE listener,
  // and the comment that sat here is now `session/escape.ts`'s file header -
  // read it for the CookieYes race this replaces. `useEscapeKey` wins that
  // race outright rather than working around it.
  useEscapeKey(onDismiss, shown);
  const place = useRailBand(shown);

  if (!shown) return null;

  return (
    <section
      className="turn-summary"
      role="note"
      aria-label="While you were away"
      style={place ?? undefined}
    >
      <div className="turn-summary-head">
        <h2 className="turn-summary-title" aria-live="polite">
          While you were away
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="turn-summary-close"
          onClick={onDismiss}
          aria-label="Dismiss the turn summary"
        >
          ×
        </button>
      </div>
      <ul className="turn-summary-list">
        {lines.map((line, i) => (
          <li key={`${line.seat}-${i}`} className="turn-summary-line">
            <span className="turn-summary-icons" aria-hidden="true">
              {line.icons.map((suit, j) => (
                <SuitDot key={`${suit}-${j}`} suit={suit} />
              ))}
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SuitDot({ suit }: { suit: Suit }) {
  return (
    <span
      className="turn-summary-icon"
      style={{ background: SUIT_META[suit].pip }}
      title={SUIT_META[suit].label}
    />
  );
}

/**
 * T10b (26/09/2026): PARK THE SUMMARY IN THE RAIL'S EMPTY BAND WHEN THERE IS ONE.
 *
 * The CSS placement (`motion.css`) pins the panel to the bottom-left of the
 * window at a capped height. At 1600 and 2560 that covered the pace and report
 * controls at the foot of the rail, and at 2560 the cap cut its last line off
 * (QA D7) - while 200 to 400px of the same rail, between the last rival and the
 * foot, sat empty (QA D13). So when that band is tall enough to be worth it,
 * the panel is measured into it: over the table talk, clear of the rivals'
 * boards above (visit targets on your turn) and the foot's controls below, and
 * as tall as the band. When it is not (the 1024 floor, four seats), the CSS
 * placement stands exactly as before. Re-measured on resize.
 */
function useRailBand(shown: boolean): CSSProperties | null {
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const measure = () => {
      const rail = document.querySelector('.rail-column');
      const foot = document.querySelector('.rail-foot');
      const rivals = [...document.querySelectorAll('.rail .rival, .rail .standings')];
      if (!rail || !foot || rivals.length === 0) return setPlace(null);
      const r = rail.getBoundingClientRect();
      const top = Math.max(...rivals.map((el) => el.getBoundingClientRect().bottom)) + 10;
      const bottom = foot.getBoundingClientRect().top - 8;
      if (bottom - top < 180) return setPlace(null);
      setPlace({
        left: `${Math.round(r.left)}px`,
        width: `${Math.round(r.width)}px`,
        bottom: `${Math.round(window.innerHeight - bottom)}px`,
        maxHeight: `${Math.round(bottom - top)}px`,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown]);
  return place;
}
