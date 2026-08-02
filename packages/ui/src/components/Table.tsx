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
import type { GameData } from '@gp/data';
import type { GameEvent, PlayerView, Seat } from '@gp/engine';

import { useDrag } from '../session/drag';
import { narrateAll } from '../session/narrate';
import type { Play } from '../session/play';
import { seatSuits } from '../view/table';
import { ActionBar } from './ActionBar';
import { Commons } from './Commons';
import { DragGhost } from './DragGhost';
import { EventFeed } from './EventFeed';
import { Farm } from './Farm';
import { Inspector } from './Inspector';
import { Prompt } from './Prompt';
import { RivalRail } from './RivalRail';
import { ZoomPanel, useZoom } from './Zoom';

/** Read a pixel size that layout.css owns, so the two cannot disagree. */
function useCssSize(name: string, fallback: number): number {
  const [px, setPx] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
      const value = Number.parseFloat(raw);
      if (Number.isFinite(value) && value > 0) setPx(value);
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
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
}: {
  data: GameData;
  view: PlayerView;
  events: readonly GameEvent[];
  play?: Play | undefined;
  onUndo?: (() => void) | undefined;
  canUndo?: boolean | undefined;
  waitingOn?: string | null | undefined;
}) {
  const zoom = useZoom();
  // Ticket 26. Additive by construction: it makes no moves of its own, it only
  // performs the same `hold` and the same click handler the mouse already has.
  const drag = useDrag(play);
  const [inspecting, setInspecting] = useState<Seat | null>(null);
  const suits = seatSuits(view);
  const lines = narrateAll(data, events, suits, view.seat);

  const building = useCssSize('--card-building', 128);
  const hand = useCssSize('--card-hand', 190);
  const deck = useCssSize('--card-deck', 96);
  const islandTile = useCssSize('--island-tile-w', 62);
  const inspector = useCssSize('--card-inspector', 150);

  useEffect(() => {
    if (inspecting === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspecting(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspecting]);

  return (
    <div className="table" data-phase={view.phase}>
      <aside className="rail-column">
        <RivalRail data={data} view={view} onInspect={setInspecting} play={play} />
        <EventFeed lines={lines} suits={suits} />
      </aside>

      <main className="main-column">
        <Commons
          data={data}
          view={view}
          cardWidth={deck}
          islandTile={islandTile}
          zoom={zoom}
          play={play}
        />
        <Farm
          data={data}
          view={view}
          buildingWidth={building}
          handWidth={hand}
          zoom={zoom}
          play={play}
          drag={drag}
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

      <ZoomPanel data={data} zoom={zoom} />
      <DragGhost data={data} drag={drag} width={hand} />

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

      {view.endTrigger && (
        <p className="end-banner" role="status">
          The island&rsquo;s top level is claimed. One more turn each.
        </p>
      )}
    </div>
  );
}
