/**
 * Ticket 24 builds the STATIC half of the interface: render any `PlayerView`
 * faithfully. Nothing here takes a move - the move surface is ticket 25 - so the
 * app's job is to seed an honest position and hand the view over.
 *
 * The position is real, not fixture data: ticket 09 found that driving a seeded
 * engine position beats placeholder data for any UI question, because the shape
 * of a real mid-game table is not the shape you would have invented.
 *
 * Query string, for looking at the interface under different loads:
 *   ?seats=2..4   ?suits=wheat,vegetable,orchard   ?seed=x   ?depth=n
 */

import { useMemo } from 'react';
import type { Suit } from '@gp/data';

import { Table } from './components/Table';
import { data, dealTable } from './session/table';
import type { TableOptions } from './session/table';

const ALL_SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

export function readOptions(search: string): TableOptions {
  const q = new URLSearchParams(search);
  const seats = Math.min(4, Math.max(2, Number(q.get('seats') ?? 4) || 4));
  const asked = (q.get('suits') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Suit => (ALL_SUITS as string[]).includes(s));
  // Vegetable is in by default so the Aerodrome is on the table: worst-case
  // density is the honest case to design against.
  const suits = asked.length === seats ? asked : ALL_SUITS.slice(0, seats);
  const depth = Number(q.get('depth') ?? 320);
  const minHand = Number(q.get('minHand') ?? 4);
  return {
    seats,
    suits,
    seed: q.get('seed') ?? 'greener-pastures',
    depth: Number.isFinite(depth) && depth >= 0 ? depth : 320,
    minHand: Number.isFinite(minHand) && minHand >= 0 ? minHand : 4,
  };
}

export function App() {
  const opts = useMemo(
    () => readOptions(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );
  const table = useMemo(() => dealTable(opts), [opts]);

  return <Table data={data} view={table.view} events={table.events} />;
}
