/**
 * The reading surface: the one place any card is read in full.
 *
 * Every other surface - the tableau, the rail, the commons and now the hand -
 * renders cards small enough that the ability band is suppressed (see
 * card.css), which is only honest because this exists. It fetches the 1040px
 * art tier, so the play tier stays small and the heavy image is only ever
 * requested for a card someone is actually reading.
 *
 * It has TWO shapes, and exactly one of them is mounted at a time (`Table.tsx`
 * chooses on `--card-read`):
 *
 *   region   a real column of `.farm`, in the normal flow, permanently there.
 *            This is the one the redesign is built around: a fixed place your
 *            eye learns, rather than something that appears near your pointer.
 *   overlay  the original floating panel, `position: fixed` in the corner. Kept
 *            for the floor step, where there is no width to give a column and a
 *            panel that costs no layout space is the only thing that fits.
 *
 * The second face of an upgradable starter - "what does this become when I flip
 * it" - is a reading question too, and both shapes answer it. They answer it
 * DIFFERENTLY since step B: the region folds it into `Reading`'s gloss block,
 * which is a column that knows how to run out of room, while the overlay keeps
 * the free-standing `zoom-other` paragraph it always had. The overlay is
 * `position: fixed` with nothing under it, so a paragraph that grows costs
 * nothing there; in the column it was landing on the card art at 1366.
 */

import { useCallback, useState } from 'react';
import type { GameData } from '@gp/data';

import type { Play } from '../session/play';
import { printedFace } from '../view/printed';
import { farmsteadOf } from '../view/table';
import { Card } from './Card';
import { Reading } from './Reading';

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
  variant = 'overlay',
  play,
}: {
  data: GameData;
  zoom: Zoomer;
  width?: number;
  variant?: 'region' | 'overlay';
  /**
   * The live position, for the gloss block's "right now" line. Optional and
   * genuinely so: the render tests and the rival inspector mount this with no
   * play object at all, and the gloss drops that section rather than guessing
   * at one. The overlay variant ignores it - at the floor step the panel has no
   * room under the card for a gloss and does not pretend to.
   */
  play?: Play | undefined;
}) {
  const region = variant === 'region';

  /*
   * THE IDLE STATE IS THE DIFFERENCE BETWEEN THE TWO VARIANTS.
   *
   * The overlay is allowed to disappear: it is `position: fixed`, so its coming
   * and going moves nothing else on screen. The region is not. It is a grid
   * column, and rendering nothing would collapse it every time the pointer
   * crossed the gap between two cards - the tableau would breathe in and out
   * under the mouse, which is a worse defect than the one this whole region was
   * built to fix.
   *
   * So the region always renders, and holds a card-shaped placeholder when
   * nothing is being read. Step B filled the space UNDER the card rather than
   * this one: what the idle region should show instead of a hint is still open
   * (the plan's §11 asks whether it is your Farmstead's live suit power), and
   * guessing at it here would be the kind of default nobody asked for. The
   * placeholder stays until that is decided.
   */
  if (!zoom.current) {
    if (!region) return null;
    /*
     * THE IDLE DEFAULT: YOUR OWN FARMSTEAD (phase 3, closing the plan's §11.1).
     *
     * Phase 2 turned this from a nicety into the top item. With the commons and
     * the rail stripped of their chrome the farm became the loudest region on
     * the screen, and a 360x260 empty rectangle inside the loudest region reads
     * as a hole - its contrast had not changed, its conspicuousness had.
     *
     * A hint was never going to fill it, because a hint is not worth reading
     * twice. The Farmstead is: it is the suit power, it is live from turn one,
     * it is the rule players forget most often at the table, and it is the only
     * card in the game whose text applies at every single moment. So the region
     * spends its idle time teaching the one thing an idle player most needs.
     *
     * IT IS A FALLBACK AND NOT A MODE. Anything hovered or held wins, because
     * `zoom.current` is checked first and this branch is only reached when there
     * is nothing at all to show. What stops the two being confused is that this
     * one is quieter (see `.reading-standing` in table.css) and captioned; a
     * player has to be able to tell "my standing power" from "the card I am
     * pointing at" without reading either.
     *
     * The read-only render path passes no `play` and gets the old hint, which is
     * correct rather than a gap: with no seat there is no "your" Farmstead.
     */
    const standing = play ? farmsteadOf(data, play.view.you.tableau) : null;
    if (standing) {
      return (
        <aside className="reading reading-standing" aria-live="polite">
          <div className="reading-body">
            <Card
              face={printedFace(data, standing.card, standing.upgraded)}
              width={width}
              zoomTier
            />
            {/* UNDER the card, not over it. Phase 1 pinned the card to the top
                of the span on purpose - "the card's top edge is in the same
                place whatever is being read" is what makes the region read as
                furniture rather than as something that appears - and a caption
                above would have pushed the card down by its own height every
                time the pointer left the farm. */}
            <p className="reading-caption">Your farm&rsquo;s power</p>
            <Reading data={data} id={standing.card} upgraded={standing.upgraded} play={play} />
          </div>
        </aside>
      );
    }
    return (
      <aside className="reading" aria-live="polite">
        <div className="reading-body">
          {/* Card-shaped and quietly filled rather than an outline round
              nothing: at this size an empty box is the biggest hole on the
              screen, and it reads as a fault rather than as a waiting slot. */}
          <div className="reading-empty">
            <p>Point at any card to read it here.</p>
          </div>
        </div>
      </aside>
    );
  }

  const { id, upgraded } = zoom.current;
  const face = printedFace(data, id, upgraded);
  const card = data.cards.catalogue.find((c) => c.id === id);
  const other = card?.faces ? printedFace(data, id, !upgraded) : null;

  /* The region wraps its contents in `.reading-body`, which is taken out of
     flow so the column can never set the height of the tableau beside it. The
     overlay has no such duty: it is fixed to the corner and measures nothing.

     The two shapes deliberately do NOT share a `body` fragment any more. They
     put different things under the card - a gloss block in one, a one-line
     footnote in the other - and pretending otherwise cost a level of
     indirection for no shared markup at all. */
  return region ? (
    <aside className="reading" aria-live="polite">
      <div className="reading-body">
        <Card face={face} width={width} zoomTier />
        <Reading data={data} id={id} upgraded={upgraded} play={play} />
      </div>
    </aside>
  ) : (
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
