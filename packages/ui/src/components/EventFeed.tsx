/**
 * The event feed. Not chrome.
 *
 * Ticket 09 measured that a bot's whole turn is followable from this alone,
 * with no animation - which makes it the mechanism for the design's own success
 * metric, "did players watch each other's turns". So it sits in the rail beside
 * the neighbours it describes, not in a collapsed drawer.
 */

import type { Suit } from '@gp/data';

import type { FeedLine } from '../session/narrate';
import { SUIT_META } from '../view/suits';

export function EventFeed({
  lines,
  suits,
  limit = 40,
}: {
  lines: readonly FeedLine[];
  suits: readonly (Suit | undefined)[];
  limit?: number;
}) {
  const shown = lines.slice(-limit);
  return (
    <section className="feed" aria-label="table talk" aria-live="polite">
      <h2 className="panel-title">Table talk</h2>
      <ol className="feed-lines">
        {shown.length === 0 && <li className="empty-note">The table is quiet.</li>}
        {shown.map((line, i) => {
          const suit = line.seat === null ? undefined : suits[line.seat];
          return (
            <li
              key={i}
              className={`feed-line feed-${line.kind}`}
              style={suit ? { ['--line-ink' as string]: SUIT_META[suit].ink } : undefined}
            >
              {line.text}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
