/**
 * The event feed. Not chrome.
 *
 * Ticket 09 measured that a bot's whole turn is followable from this alone,
 * with no animation - which makes it the mechanism for the design's own success
 * metric, "did players watch each other's turns". So it sits in the rail beside
 * the neighbours it describes, not in a collapsed drawer.
 *
 * ⭐ WHO ACTED, IN THEIR OWN INK (phase 4). The digital-board-game UI research
 * is specific that a log has to be SCANNABLE - who acted and what changed,
 * carried by colour and formatting rather than by reading every line. Ours was
 * an undifferentiated column of sentences with a 3px seat tick down the left
 * edge, which colours the line but not anything in it, so finding "what did the
 * Orchard farm just do" meant reading.
 *
 * Nearly every line `narrate.ts` writes opens with the actor's name, so the
 * cheapest possible differentiation is to draw that opening in the seat's own
 * ink. It costs one span, no new state, and NO NEW ICONOGRAPHY - a half-finished
 * icon set would be worse than none, and that is a bigger job than this phase.
 *
 * The match is checked rather than assumed. A line whose text does not start
 * with the actor's name (the end trigger, a table-level event, any wording
 * `narrate.ts` grows later) simply renders plain, so this can never slice a
 * sentence in the wrong place to make a colour appear.
 *
 * --- B10 (25/09/2026) ---------------------------------------------------
 *
 * Three things changed here and nothing about the DOM shape that table.css's
 * existing `.feed-lines` rule (`display: flex; flex-direction: column-reverse`)
 * depends on: `.feed-line` stays a flat, direct child of `.feed-lines`, because
 * that flex reversal is what already puts the newest line at the top with no
 * script at all - nesting a group wrapper would have broken it for a much
 * smaller gain.
 *
 *   stable keys   `key` is this line's own index in the FULL log, never `i`
 *                 (its position within the visible slice). `shown` slides
 *                 forward every time the log passes `limit`, so an index key
 *                 relabelled every surviving line on every single new event -
 *                 the one thing a `key` exists to prevent.
 *   turn headers  a `boundary` line ("X to play") already exists once per
 *                 turn; it now also carries `feed-turn-head`, a stronger,
 *                 seat-inked treatment than an ordinary line, so scanning the
 *                 list for "where did MY last turn end" does not mean reading
 *                 every sentence between here and there.
 *   aria-live     moved OFF the 40-line list and onto one small, visually
 *                 hidden line holding only the newest event's text. A live
 *                 region this size announces once per event; the old
 *                 `aria-live="polite"` on the whole list made a screen reader
 *                 re-read an ever-growing block on every change.
 *
 * Auto-scroll reuses the same flex-reversal fact: with the newest line first
 * in visual order, "scrolled to the newest" is `scrollTop === 0`, so staying
 * there needs no measurement of anything's position, only a check of whether
 * the reader has scrolled away from it.
 */

import { useEffect, useRef, useState } from 'react';
import type { Suit } from '@gp/data';
import type { Seat } from '@gp/engine';

import type { FeedLine } from '../session/narrate';
import { SUIT_META, seatName } from '../view/suits';

/** How far from the newest end (`scrollTop`) still counts as "reading the newest". */
const PINNED_THRESHOLD = 4;

export function EventFeed({
  lines,
  suits,
  you,
  limit = 40,
}: {
  lines: readonly FeedLine[];
  suits: readonly (Suit | undefined)[];
  /** Whose seat is reading, so the lead reads "You (Wheat)" on your own turns. */
  you: Seat;
  limit?: number;
}) {
  const shown = lines.slice(-limit);
  const listRef = useRef<HTMLOListElement>(null);
  // Starts pinned: the very first render has nothing to have scrolled away
  // from, and a reader who has not touched the feed yet should always be
  // shown the newest line as it arrives.
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = listRef.current;
    // `el` is null in the render-to-string tests (no real DOM), which is fine:
    // there is nothing to scroll there and nothing reads `pinned` back out.
    if (el && pinned) el.scrollTop = 0;
  }, [shown.length, pinned]);

  const latest = shown[shown.length - 1] ?? null;

  return (
    <section className="feed" aria-label="table talk">
      {/* The one small aria-live element the whole feed carries (B10) - see
          the file banner. Visually hidden; the printed list below is what a
          sighted reader scans. */}
      <p className="visually-hidden" aria-live="polite">
        {latest ? latest.text : 'The table is quiet.'}
      </p>
      <h2 className="panel-title">Table talk</h2>
      <ol
        className="feed-lines"
        ref={listRef}
        // WP5 item 1, 25/09/2026: `tabIndex={0}` fixes axe's
        // `scrollable-region-focusable` - a scrolling region with no focusable
        // descendant (every `<li>` here is plain text, not a control) was
        // reachable only by a mouse wheel or a touch drag. A keyboard user can
        // now Tab to the feed and scroll it with the arrow keys, same as any
        // native scrollable element with a tabindex.
        tabIndex={0}
        onScroll={(e) => setPinned(e.currentTarget.scrollTop <= PINNED_THRESHOLD)}
      >
        {shown.length === 0 && <li className="empty-note">The table is quiet.</li>}
        {shown.map((line, i) => {
          const key = lines.length - shown.length + i;
          const suit = line.seat === null ? undefined : suits[line.seat];
          const name = line.seat === null ? null : seatName(suits[line.seat], line.seat, you);
          const lead = name !== null && line.text.startsWith(name) ? name : null;
          const isTurnHead = line.kind === 'boundary';
          return (
            <li
              key={key}
              className={`feed-line feed-${line.kind}${isTurnHead ? ' feed-turn-head' : ''}`}
              style={suit ? { ['--line-ink' as string]: SUIT_META[suit].ink } : undefined}
            >
              {lead === null ? (
                line.text
              ) : (
                <>
                  <b className="feed-who">{lead}</b>
                  {line.text.slice(lead.length)}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
