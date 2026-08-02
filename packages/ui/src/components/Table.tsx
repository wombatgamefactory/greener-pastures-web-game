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
 */

import { useEffect, useState } from 'react';
import type { GameData } from '@gp/data';
import type { GameEvent, PlayerView, Seat } from '@gp/engine';

import { narrateAll } from '../session/narrate';
import { seatSuits } from '../view/table';
import { Commons } from './Commons';
import { EventFeed } from './EventFeed';
import { Farm } from './Farm';
import { Inspector } from './Inspector';
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
}: {
  data: GameData;
  view: PlayerView;
  events: readonly GameEvent[];
}) {
  const zoom = useZoom();
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
        <RivalRail data={data} view={view} onInspect={setInspecting} />
        <EventFeed lines={lines} suits={suits} />
      </aside>

      <main className="main-column">
        <Commons data={data} view={view} cardWidth={deck} islandTile={islandTile} zoom={zoom} />
        <Farm data={data} view={view} buildingWidth={building} handWidth={hand} zoom={zoom} />
      </main>

      <ZoomPanel data={data} zoom={zoom} />

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
