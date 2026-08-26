/**
 * The card in flight.
 *
 * Always mounted, empty when nothing is being dragged, so `useDrag` has a ref to
 * write a transform to from the very first pointermove - a ghost that appeared
 * with the drag would miss its own opening frame and jump into place.
 *
 * It is `pointer-events: none` (see play.css) for the same reason the zoom panel
 * is: the drag hit-tests with `elementFromPoint`, and a ghost under the cursor
 * would be the only thing it ever found.
 */

import type { GameData } from '@gp/data';

import type { Drag } from '../session/drag';
import { printedFace } from '../view/printed';
import { Card } from './Card';

export function DragGhost({ data, drag, width }: { data: GameData; drag: Drag; width: number }) {
  return (
    <div className="drag-ghost" ref={drag.ghost} aria-hidden="true">
      {/* No `card-readable`, because the hand dropped it on 26/08: this card was
          in hand a frame ago and is going back there if the drop misses, so it
          must not change costume in flight. */}
      {drag.card && <Card face={printedFace(data, drag.card)} width={width} />}
    </div>
  );
}
