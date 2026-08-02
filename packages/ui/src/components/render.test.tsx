/**
 * Render the whole interface against real engine positions and check the two
 * things a static render can actually prove:
 *
 *  1. It renders at all, at every seat count, from a position the engine
 *     produced rather than a fixture - including the awkward ones (a seat with
 *     no Notice Board, an empty hand, a finished game).
 *  2. **Every image it asks for exists on disk.** This is the one that earns its
 *     keep: the frame layer names are derived from the sheet's vocabulary, and a
 *     typo in one of them is invisible in review, invisible in typecheck, and
 *     shows up as a silently missing icon in the browser.
 *
 * Layout is NOT tested here - a static string has no boxes. That is
 * `tools/verify-layout.mjs`, which measures a real browser.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { dealTable } from '../session/table';
import type { TableOptions } from '../session/table';
import { Card } from './Card';
import { Inspector } from './Inspector';
import { Table } from './Table';
import { ZoomPanel } from './Zoom';
import { printedFace } from '../view/printed';

const PUBLIC = join(import.meta.dirname, '..', '..', 'public');
const BASE: string = import.meta.env.BASE_URL;

function positions(): { name: string; opts: TableOptions }[] {
  return [
    {
      name: '2 seats, opening',
      opts: { seats: 2, suits: ['wheat', 'vegetable'], seed: 'r2', depth: 0, minHand: 0 },
    },
    {
      name: '3 seats, mid-game',
      opts: {
        seats: 3,
        suits: ['wheat', 'vegetable', 'orchard'],
        seed: 'r3',
        depth: 220,
        minHand: 3,
      },
    },
    {
      name: '4 seats, deep',
      opts: {
        seats: 4,
        suits: ['wheat', 'vegetable', 'orchard', 'dairy'],
        seed: 'r4',
        depth: 420,
        minHand: 3,
      },
    },
  ];
}

function imageSources(html: string): string[] {
  return [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1] as string);
}

/** Turn a rendered URL back into the file it must be served from. */
function assetPath(url: string): string | null {
  if (!url.startsWith(`${BASE}art/`)) return null;
  return join(PUBLIC, url.slice(BASE.length).split('/').join('/'));
}

describe('the table renders', () => {
  for (const { name, opts } of positions()) {
    it(`renders ${name}`, () => {
      const table = dealTable(opts);
      const html = renderToStaticMarkup(
        <Table data={data} view={table.view} events={table.events} />,
      );
      expect(html).toContain('your farm');
      // Every neighbour is on the rail, which is the whole point of layout B.
      expect(html.match(/class="rival[ "]/g) ?? []).toHaveLength(opts.seats - 1);
      expect(html).toContain('Table talk');
    });
  }

  it('shows the Aerodrome only when Vegetable is at the table', () => {
    const withVeg = dealTable({
      seats: 2,
      suits: ['wheat', 'vegetable'],
      seed: 'aero',
      depth: 40,
      minHand: 0,
    });
    const without = dealTable({
      seats: 2,
      suits: ['wheat', 'orchard'],
      seed: 'aero',
      depth: 40,
      minHand: 0,
    });
    expect(renderToStaticMarkup(<Table data={data} view={withVeg.view} events={[]} />)).toContain(
      'Aerodrome',
    );
    expect(
      renderToStaticMarkup(<Table data={data} view={without.view} events={[]} />),
    ).not.toContain('Aerodrome');
  });

  it('renders a seat whose Notice Board no longer exists (ticket 30)', () => {
    const table = dealTable({
      seats: 3,
      suits: ['wheat', 'vegetable', 'dairy'],
      seed: 'noboard',
      depth: 180,
      minHand: 0,
    });
    const rival = table.view.rivals[0]!;
    const maimed: PlayerView = {
      ...table.view,
      rivals: table.view.rivals.map((r) =>
        r.seat === rival.seat
          ? {
              ...r,
              tableau: r.tableau.filter(
                (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot !== 'noticeboard',
              ),
            }
          : r,
      ),
    };
    const html = renderToStaticMarkup(<Table data={data} view={maimed} events={[]} />);
    expect(html).toContain('cannot be visited');
  });

  it('renders the inspector and the zoom panel for every seat', () => {
    const table = dealTable({
      seats: 4,
      suits: ['wheat', 'vegetable', 'orchard', 'apiary'],
      seed: 'insp',
      depth: 260,
      minHand: 2,
    });
    for (const rival of table.view.rivals) {
      const html = renderToStaticMarkup(
        <Inspector
          data={data}
          view={table.view}
          seat={rival.seat}
          cardWidth={150}
          zoom={{ current: null, show: () => {}, clear: () => {} }}
          onClose={() => {}}
        />,
      );
      expect(html).toContain('close');
    }
    const zoom = renderToStaticMarkup(
      <ZoomPanel
        data={data}
        zoom={{ current: { id: 'W1', upgraded: false }, show: () => {}, clear: () => {} }}
      />,
    );
    expect(zoom).toContain('Upgraded Barn');
  });
});

describe('every image the interface asks for exists', () => {
  it('for every one of the 105 cards, both faces', () => {
    const missing: string[] = [];
    for (const card of data.cards.catalogue) {
      const faces = card.faces
        ? [printedFace(data, card.id), printedFace(data, card.id, true)]
        : [printedFace(data, card.id)];
      for (const face of faces) {
        const html = renderToStaticMarkup(<Card face={face} width={300} />);
        for (const url of imageSources(html)) {
          const path = assetPath(url);
          if (path && !existsSync(path))
            missing.push(`${face.id}${face.upgraded ? 'u' : ''}: ${url}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('for the whole table, including the commons, the island and the tokens', () => {
    const missing: string[] = [];
    for (const { opts } of positions()) {
      const table = dealTable(opts);
      const html = renderToStaticMarkup(
        <Table data={data} view={table.view} events={table.events} />,
      );
      for (const url of imageSources(html)) {
        const path = assetPath(url);
        if (path && !existsSync(path)) missing.push(url);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('for the zoom tier, which is a different set of files', () => {
    const missing: string[] = [];
    for (const card of data.cards.catalogue) {
      const html = renderToStaticMarkup(
        <Card face={printedFace(data, card.id)} width={420} zoomTier />,
      );
      for (const url of imageSources(html)) {
        const path = assetPath(url);
        if (path && !existsSync(path)) missing.push(url);
      }
    }
    expect(missing).toEqual([]);
  });
});
