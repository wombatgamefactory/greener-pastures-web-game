/**
 * Hover zoom: the one place any card is read in full.
 *
 * The tableau, the rail and the commons render cards small enough that the
 * ability band is suppressed (see card.css), which is only honest because this
 * exists. It fetches the 1040px art tier, so the play tier stays small and the
 * heavy image is only ever requested for a card someone is actually reading.
 *
 * The hand no longer needs it: those cards print their text and grow on hover.
 * The panel still answers them, because it is also the second face of an
 * upgradable starter and the only place `zoom-other` is shown.
 */

import { useCallback, useState } from 'react';
import type { GameData } from '@gp/data';

import { printedFace } from '../view/printed';
import { Card } from './Card';

export interface Zoomed {
  readonly id: string;
  readonly upgraded: boolean;
}

export interface Zoomer {
  readonly current: Zoomed | null;
  show(id: string, upgraded?: boolean): void;
  clear(): void;
}

export function useZoom(): Zoomer {
  const [current, setCurrent] = useState<Zoomed | null>(null);
  const show = useCallback((id: string, upgraded = false) => {
    // A masked id (`W?`) names no card: the suit is public, the identity is not.
    if (id.endsWith('?')) return;
    setCurrent({ id, upgraded });
  }, []);
  const clear = useCallback(() => setCurrent(null), []);
  return { current, show, clear };
}

export function ZoomPanel({
  data,
  zoom,
  width = 400,
}: {
  data: GameData;
  zoom: Zoomer;
  width?: number;
}) {
  if (!zoom.current) return null;
  const face = printedFace(data, zoom.current.id, zoom.current.upgraded);
  const card = data.cards.catalogue.find((c) => c.id === zoom.current?.id);
  const other = card?.faces ? printedFace(data, zoom.current.id, !zoom.current.upgraded) : null;

  return (
    <aside className="zoom" aria-live="polite">
      <Card face={face} width={width} zoomTier />
      {other && (
        <p className="zoom-other">
          <b>
            {other.upgraded ? 'Upgraded' : 'Base'} face - {other.name}:
          </b>{' '}
          {other.abilityText}
        </p>
      )}
    </aside>
  );
}
