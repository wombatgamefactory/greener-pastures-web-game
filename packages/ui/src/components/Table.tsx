/**
 * The B shell: focus plus rail.
 *
 * Your farm owns the screen; your neighbours compress to a left rail carrying
 * only what a visit decision needs. Chosen by Dean in ticket 09 over the round
 * table (A) and seat parity (C), because the rail is a permanent "who should I
 * visit" scoreboard - the hook is legible with no interaction at all - and it is
 * the layout that survives the 1024x700 floor. C dropped two rivals below the
 * fold at 1024 and is dead.
 *
 * Card sizes come from CSS custom properties rather than from here, so the
 * responsive steps live with the rest of the layout in table.css and this file
 * only reads them.
 *
 * `play` is optional. With it the table is playable (ticket 25); without it the
 * same tree renders a position and nothing is clickable (ticket 24), which is
 * what the render tests drive.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameData } from '@gp/data';
import type { GameEvent, PlayerView, Seat } from '@gp/engine';

import { useDrag } from '../session/drag';
import { narrateAll } from '../session/narrate';
import type { Play } from '../session/play';
import { SUIT_META } from '../view/suits';
import { seatSuits } from '../view/table';
import { ActionBar } from './ActionBar';
import { Commons } from './Commons';
import { DragGhost } from './DragGhost';
import { EventFeed } from './EventFeed';
import { Farm } from './Farm';
import { Inspector } from './Inspector';
import { IslandOverlay } from './Island';
import { Prompt } from './Prompt';
import { RivalRail } from './RivalRail';
import { SCALE_EVENT } from './UiScale';
import { ZoomPanel, useZoom } from './Zoom';

/**
 * Read a pixel size that layout.css owns, so the two cannot disagree.
 *
 * Zero is accepted as a value, not treated as a miss. `--card-read` uses 0 to
 * mean "this step has no room for a reading region", so a `> 0` guard would
 * leave a browser that had been resized down from the desktop step still
 * holding 360 and rendering a column the CSS had already collapsed. A property
 * that genuinely is not set parses to NaN and is still rejected by the finite
 * check, which is the case the guard was there for.
 */
function useCssSize(name: string, fallback: number): number {
  const [px, setPx] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
      const value = Number.parseFloat(raw);
      if (Number.isFinite(value) && value >= 0) setPx(value);
    };
    read();
    window.addEventListener('resize', read);
    /*
     * The UI scale slider (phase 5) rewrites these same tokens as inline
     * properties on `:root`, and a resize can change the step underneath it. It
     * cannot be caught by the resize listener above: React registers child
     * effects before parent ones, so this listener fires BEFORE the one that
     * re-derives the scale and would read the outgoing value. `SCALE_EVENT` is
     * dispatched synchronously once the new values are in place, and React
     * batches the two updates into one render.
     */
    window.addEventListener(SCALE_EVENT, read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener(SCALE_EVENT, read);
    };
  }, [name]);
  return px;
}

export function Table({
  data,
  view,
  events,
  play,
  onUndo,
  canUndo = false,
  waitingOn = null,
  notice = null,
  corner = null,
}: {
  data: GameData;
  view: PlayerView;
  events: readonly GameEvent[];
  play?: Play | undefined;
  onUndo?: (() => void) | undefined;
  canUndo?: boolean | undefined;
  waitingOn?: string | null | undefined;
  /**
   * A table-wide announcement from outside the table: today only App's supply
   * lock. Rendered in the same strip as the end trigger, because the two are
   * the same kind of thing and neither should be a floating banner.
   */
  notice?: string | null | undefined;
  /**
   * THE QUIET CORNER: the pace buttons and the capture trigger, handed in by
   * App because both are session controls rather than table furniture.
   *
   * They are a PROP rather than App's own siblings because both used to be
   * `position: fixed` in the bottom-left of the viewport, which is precisely
   * where the event feed draws its last line - so they printed over it at every
   * viewport in every screenshot the project has ever taken. Inside the rail
   * column they get a row of their own and can no longer overlap anything.
   */
  corner?: ReactNode;
}) {
  const zoom = useZoom();
  const seatMeta = SUIT_META[view.you.suit];
  /*
   * IN THE FLOW, NOT OVER IT. Both notices used to be `position: fixed` at the
   * top centre of the viewport, which is where the commons draws its DECKS and
   * THE ISLAND captions - so the end-game banner printed across them in every
   * screenshot, and phase 2 made it worse by taking the panels out from behind
   * them. A row at the top of the column cannot overlap anything by
   * construction, and it only exists in the states that have something to say.
   */
  const notices = [
    view.endTrigger ? 'The island’s top level is claimed. One more turn each.' : null,
    notice,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);
  // Ticket 26. Additive by construction: it makes no moves of its own, it only
  // performs the same `hold` and the same click handler the mouse already has.
  const drag = useDrag(play);
  const [inspecting, setInspecting] = useState<Seat | null>(null);
  const [islandOpen, setIslandOpen] = useState(false);
  const suits = seatSuits(view);
  const lines = narrateAll(data, events, suits, view.seat);

  const building = useCssSize('--card-building', 128);
  const hand = useCssSize('--card-hand', 190);
  const deck = useCssSize('--card-deck', 96);
  const islandTile = useCssSize('--island-tile-w', 62);
  const inspector = useCssSize('--card-inspector', 150);

  /*
   * Which shape the reading surface takes is decided here and nowhere else, off
   * the one number base.css publishes for it. Above zero the farm gets a real
   * column; at zero - the 1024x700 floor, where a readable column would have to
   * be taken out of the tableau - it falls back to the floating overlay, which
   * costs no layout width because it is `position: fixed`.
   *
   * EXACTLY ONE IS MOUNTED. Both at once would put the same card on screen
   * twice, and the overlay would sit on top of the column it duplicates.
   */
  const read = useCssSize('--card-read', 0);
  const readAsRegion = read > 0;

  /*
   * Escape closes whichever overlay is up. One listener for both, mounted only
   * while there is something to close, so Escape keeps its other meaning (the
   * play layer's "put the card down") on every other frame.
   */
  const overlaid = inspecting !== null || islandOpen;
  useEffect(() => {
    if (!overlaid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setInspecting(null);
      setIslandOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlaid]);

  return (
    <div className="table" data-phase={view.phase}>
      <aside className="rail-column">
        <RivalRail data={data} view={view} onInspect={setInspecting} play={play} />
        <EventFeed lines={lines} suits={suits} you={view.seat} />
        <div className="rail-foot">{corner}</div>
      </aside>

      {/*
       * THE DEAD MARGIN (phase 2, from the digital-board-game UI research).
       *
       * Clicking the empty table around the play area clears whatever is armed
       * or held. Escape already did this and still does; the point is that a
       * player who has picked up a card and changed their mind should not have
       * to know that. Putting the card down is a gesture, and the gesture people
       * reach for is "click somewhere else".
       *
       * `e.target === e.currentTarget` IS THE WHOLE SAFETY ARGUMENT, and it is
       * why this is not a document-level listener with an exclusion list. Grid
       * areas are not elements, so a click that lands in the band under the farm
       * or in a row gap hits `<main>` itself and nothing else; a click on a
       * card, a button, a deck or any other descendant reports that descendant
       * as the target and is ignored here without anything having to enumerate
       * what counts as interactive. An exclusion list would need updating every
       * time a control was added, and would fail silently - by cancelling a
       * selection mid-move - when somebody forgot.
       *
       * Cancelling with nothing selected is a no-op (`cancel` sets the intent to
       * IDLE and clears the picks), so there is no state in which an idle click
       * on bare table does anything at all.
       */}
      <main
        className={`main-column${notices.length > 0 ? ' main-noticed' : ''}`}
        onClick={
          play
            ? (e) => {
                if (e.target === e.currentTarget) play.cancel();
              }
            : undefined
        }
        /*
         * THE SEAT'S COLOUR, HANDED TO THE WHOLE COLUMN.
         *
         * `--seat-pip` was set on `.farm` alone, so the turn bar - a sibling -
         * resolved it to nothing and every rule that wanted it fell back to a
         * hard-coded green. Phase 3's "go" affordance is the seat's colour, and
         * a go light that is green on a Wheat farm and green on an Orchard farm
         * is one more thing on screen that is nobody's. The rail is NOT in this
         * column and is unaffected: each neighbour sets its own.
         */
        style={{ ['--seat-ink' as string]: seatMeta.ink, ['--seat-pip' as string]: seatMeta.pip }}
      >
        {notices.length > 0 && (
          <div className="table-notice" role="status">
            {notices.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        <Commons
          data={data}
          view={view}
          cardWidth={deck}
          islandTile={islandTile}
          zoom={zoom}
          play={play}
          onExpandIsland={() => setIslandOpen(true)}
        />
        <Farm
          data={data}
          view={view}
          buildingWidth={building}
          handWidth={hand}
          zoom={zoom}
          play={play}
          drag={drag}
          reading={
            readAsRegion ? (
              <ZoomPanel data={data} zoom={zoom} width={read} variant="region" play={play} />
            ) : null
          }
        />
        {play && (
          <>
            <Prompt data={data} play={play} zoom={zoom} />
            <ActionBar
              data={data}
              play={play}
              onUndo={onUndo ?? (() => {})}
              canUndo={canUndo}
              waitingOn={waitingOn}
            />
          </>
        )}
      </main>

      {!readAsRegion && <ZoomPanel data={data} zoom={zoom} />}
      <DragGhost data={data} drag={drag} width={hand} />

      {islandOpen && (
        <IslandOverlay data={data} view={view} play={play} onClose={() => setIslandOpen(false)} />
      )}

      {inspecting !== null && (
        <Inspector
          data={data}
          view={view}
          seat={inspecting}
          cardWidth={inspector}
          zoom={zoom}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
