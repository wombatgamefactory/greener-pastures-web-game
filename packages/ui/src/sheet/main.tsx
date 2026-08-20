/**
 * The card sheet renderer: the same printed card the game draws, laid out on a
 * print sheet and screenshotted by `tools/render-sheets.mjs`.
 *
 * This exists so a card can be re-cut WITHOUT InDesign. The layout pipeline in
 * the physical project needs Windows, a licensed InDesign and a local .indd, so
 * only one person on the design team can regenerate a sheet. `Card.tsx` already
 * reproduces the printed 1039 x 750 geometry from measured layer positions, and
 * `printed.test.ts` asserts it card-for-card against the source data, so the
 * renderer that draws the game can draw the sheet too.
 *
 * Deliberately a SECOND Vite entry rather than a route on the app: the game
 * bundle should not carry it, and a screenshot target wants a bare page with no
 * chrome, no analytics and no router.
 *
 * Query parameters:
 *   ?suit=wheat            one sheet, 7 x 4 cards, 7277 x 3001 (the TTS size)
 *   ?card=W1&upgraded=1    one card at exactly 1039 x 750, for a fidelity diff
 *   ?scale=0.25            render smaller; the screenshot tool scales back up
 *
 * NOT a print master. The printed cards are set in Berlin Sans FB and this
 * draws them in Fredoka, which sets ~8% wider - see `FIT_CORRECTION` below.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BASE_GAME_DATA } from '@gp/data';
import type { GameData, Suit } from '@gp/data';

import { Card } from '../components/Card';
import { printedFace } from '../view/printed';
import type { PrintedFace } from '../view/printed';
import '../styles.css';
import './sheet.css';

/** The historic sheet size, and the grid the .indd template cuts it into. */
const SHEET = { width: 7277, height: 3001, cols: 7, rows: 4 } as const;
const CELL_W = SHEET.width / SHEET.cols;
const CELL_H = SHEET.height / SHEET.rows;

/**
 * Fredoka sets 8.2% wider than Berlin Sans FB at the same size, measured over
 * all 123 real ability lines in the catalogue (range 1.057-1.109). Text that
 * fits HERE therefore fits in print, but not the reverse - so this page errs
 * long and never gives false confidence. The number is used by the overset
 * check, not applied to the glyphs: shrinking the type to match the metrics
 * would make the proof lie about how the card LOOKS.
 */
export const FIT_CORRECTION = 1 / 1.082;

/**
 * The cards this page draws.
 *
 * `sheet-cards.json` is a working copy extracted from the shared Google Sheet
 * (see `tools/sheet-cards.mjs`). It is deliberately NOT `cards.json`: the
 * game's baseline and the sheet disagree on purpose - the Notice Board
 * threshold is the shipped 5 in the baseline and an experiment in the sheet -
 * and the `noticeboard-threshold-*` overlays measure precisely that gap. This
 * page shows the designers what the SHEET says, which is the point of it,
 * without letting the sheet redefine what the simulator is measuring against.
 *
 * Absent (nobody has fetched the sheet), it falls back to the baseline so the
 * page still renders.
 */
async function loadData(): Promise<GameData> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sheet-cards.json`);
    if (!res.ok) return BASE_GAME_DATA;
    return { ...BASE_GAME_DATA, cards: await res.json() };
  } catch {
    return BASE_GAME_DATA;
  }
}

function faces(data: GameData, suit: Suit): PrintedFace[] {
  const out: PrintedFace[] = [];
  for (const card of data.cards.catalogue) {
    if (card.suit !== suit) continue;
    out.push(printedFace(data, card.id, false));
    if (card.faces) out.push(printedFace(data, card.id, true));
  }
  return out;
}

function Sheet({ data, suit }: { data: GameData; suit: Suit }) {
  const cards = faces(data, suit);
  const capacity = SHEET.cols * SHEET.rows;
  if (cards.length > capacity) {
    throw new Error(`${suit}: ${cards.length} faces exceeds the ${capacity}-slot sheet`);
  }
  return (
    <div
      className="sheet"
      style={{
        width: `${SHEET.width}px`,
        height: `${SHEET.height}px`,
        gridTemplateColumns: `repeat(${SHEET.cols}, ${CELL_W}px)`,
        gridTemplateRows: `repeat(${SHEET.rows}, ${CELL_H}px)`,
      }}
    >
      {cards.map((face) => (
        <div className="sheet-cell" key={`${face.id}${face.upgraded ? 'u' : ''}`}>
          <Card face={face} width={CELL_W} zoomTier />
        </div>
      ))}
    </div>
  );
}

function Single({ data, id, upgraded }: { data: GameData; id: string; upgraded: boolean }) {
  const face = printedFace(data, id, upgraded);
  return (
    <div className="sheet sheet-single" style={{ width: '1039px', height: '750px' }}>
      <div className="sheet-cell">
        <Card face={face} width={1039} zoomTier />
      </div>
    </div>
  );
}

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const cardId = params.get('card');
const suit = (params.get('suit') ?? 'wheat') as Suit;

document.body.style.setProperty('--sheet-scale', String(scale));

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from sheet.html');

const data = await loadData();

createRoot(container).render(
  <StrictMode>
    {cardId ? (
      <Single data={data} id={cardId.toUpperCase()} upgraded={params.get('upgraded') === '1'} />
    ) : (
      <Sheet data={data} suit={suit} />
    )}
  </StrictMode>,
);
