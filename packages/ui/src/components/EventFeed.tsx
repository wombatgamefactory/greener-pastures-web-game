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
 */

import type { Suit } from '@gp/data';
import type { Seat } from '@gp/engine';

import type { FeedLine } from '../session/narrate';
import { SUIT_META, seatName } from '../view/suits';

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
  return (
    <section className="feed" aria-label="table talk" aria-live="polite">
      <h2 className="panel-title">Table talk</h2>
      <ol className="feed-lines">
        {shown.length === 0 && <li className="empty-note">The table is quiet.</li>}
        {shown.map((line, i) => {
          const suit = line.seat === null ? undefined : suits[line.seat];
          const name = line.seat === null ? null : seatName(suits[line.seat], line.seat, you);
          const lead = name !== null && line.text.startsWith(name) ? name : null;
          return (
            <li
              key={i}
              className={`feed-line feed-${line.kind}`}
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
