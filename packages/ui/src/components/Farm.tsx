/**
 * Your farm, and the tableau renderer the rival inspector reuses.
 *
 * The tableau is the one place a card is shown WITH its stack, so the gauge is
 * drawn over the card rather than beside it: a building and how full it is are
 * one object on the table, and separating them was the thing variant C got
 * wrong. Hand and barn sit under it because they are the two halves of the
 * clock - hand is what you can spend this turn, barn is what the island wants.
 *
 * Since 26/08 the farm is two columns: everything above on the left, and the
 * reading region on the right. The region is passed in rather than built here,
 * because which shape it takes is a question about the viewport (`Table.tsx`
 * owns that) and not about your farm.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameData, Suit } from '@gp/data';
import type { BuildingView, Move, PlayerView } from '@gp/engine';

import { useHandDock } from '../session/dock';
import type { Drag } from '../session/drag';
import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon, frame, token } from '../view/art';
import { dropZone } from '../view/drop';
import { clickCardPower } from '../view/intent';
import { cardName, describeMove } from '../view/moveText';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { displayOrder, liveThreshold, receiptTotal } from '../view/table';
import { Card, CardBack } from './Card';
import { StackGauge } from './StackGauge';
import type { Zoomer } from './Zoom';

/**
 * A row of buildings. Shared by your farm and the rival inspector, which is why
 * `play` is optional: a neighbour's tableau is read-only, and passing no play
 * object is how that is enforced rather than remembered.
 *
 * PHASE 3 GAVE IT ONE NEW JOB: the standing move a built card offers is now
 * made ON THE CARD, through a badge, rather than through a "Card power" button
 * fourteenth in a flat turn bar that named no card at all. The research is
 * explicit - do not replace a board component's action with a bar button;
 * players should act on the board the way they would at the table.
 */
export function Tableau({
  data,
  buildings,
  cardWidth,
  zoom,
  play,
}: {
  data: GameData;
  buildings: readonly BuildingView[];
  cardWidth: number;
  zoom: Zoomer;
  play?: Play | undefined;
}) {
  return (
    <div className="tableau" onMouseLeave={() => zoom.clear()}>
      {displayOrder(data, buildings).map((b) => {
        const face = printedFace(data, b.card, b.upgraded);
        // The enforced threshold, not the printed one - the gauge and the "full"
        // flag say when this building has clogged, and the engine is the
        // authority on that. See `liveThreshold` in view/table.ts.
        const threshold = liveThreshold(data, b.card, face.threshold);
        const full = threshold !== null && b.stack.length >= threshold;
        const live = play?.live.buildings.has(b.card) ?? false;
        // Read off the engine's own list, like every other affordance here. A
        // card with nothing standing draws no badge, so the badge appearing IS
        // the news, and there is never a dead one to learn to ignore.
        const powers = play?.active ? clickCardPower(play.moves, b.card) : [];
        const powerTitle =
          play && powers.length === 1
            ? describeMove(data, play.view, powers[0] as Move)
            : `${cardName(data, b.card)}: ${powers.length} ways to use it`;
        return (
          <div
            key={b.card}
            className={`building${full ? ' building-full' : ''}${mark(play, live)}`}
            {...(play ? dropZone('building', b.card) : {})}
            onMouseEnter={() => zoom.show(b.card, b.upgraded)}
            onClick={live ? () => play?.building(b.card) : undefined}
            role={live ? 'button' : undefined}
            tabIndex={live ? 0 : undefined}
            onKeyDown={
              live
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') play?.building(b.card);
                  }
                : undefined
            }
          >
            <Card face={face} width={cardWidth} />
            <div className="building-gauge">
              <StackGauge stack={b.stack} threshold={threshold} />
            </div>
            {full && <span className="building-clog">full</span>}
            {powers.length > 0 && (
              /* `stopPropagation` because the card underneath is very often a
                 target of something else at the same moment - a harvest, a sow,
                 a GROW - and a badge that also fired the card's own click would
                 be the one control on this screen that does two things. */
              <button
                type="button"
                className="building-power"
                title={powerTitle}
                onClick={(e) => {
                  e.stopPropagation();
                  play?.cardPower(b.card);
                }}
              >
                power
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Barn({ barn, cardWidth }: { barn: Partial<Record<Suit, number>>; cardWidth: number }) {
  const entries = (Object.entries(barn) as [Suit, number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="barn">
      <h3 className="strip-title">
        Barn <em>{total} cards</em>
      </h3>
      <div className="barn-piles">
        {entries.length === 0 && <p className="empty-note">Empty. The island needs feeding.</p>}
        {entries.map(([suit, n]) => (
          <div key={suit} className="barn-pile" title={`${n} ${SUIT_META[suit].label} in the barn`}>
            <CardBack suit={suit} width={cardWidth} count={n} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Your hand: the game's real clock, and the one place a click means "pick up"
 * rather than "play here".
 *
 * A held card is lifted out of the fan and its destinations light up elsewhere -
 * ticket 09's rule, because every card in hand is a legal visit fee and glowing
 * the sources would glow the lot. `is-picked` is the other selection state: a
 * card marked for a discard or chosen as payment, which is a commitment rather
 * than a question.
 *
 * The hand used to be the one region that did NOT feed the reading surface: its
 * cards printed their own text and grew under the pointer. That was reversed on
 * 26/08. Sending them to a floating panel had genuinely been worse - the same
 * card ended up on screen twice, overlapping, and at the 700px floor the panel
 * covered the card you were reading - but a region with a fixed home cannot
 * collide with the fan, so the objection is gone and the hand can be small.
 *
 * `onMouseLeave` clears on the CONTAINER rather than per card, matching
 * `Tableau`: leaving one card for the next one along should hand the region
 * over, not blank it in between.
 *
 * ⭐ AND SINCE 27/08 THE FAN MAGNIFIES UNDER THE POINTER (`session/dock.ts`),
 * WHICH IS NOT THE THING DELETED ABOVE AND THE DIFFERENCE IS THE WHOLE POINT.
 * The old hover-zoom grew ONE card, in place, over the top of the neighbours
 * you were reaching for next. A dock grows the neighbours too and shifts them
 * apart by exactly the growth, so no card is ever more covered than it is at
 * rest - a property the geometry is tested for in `view/dock.test.ts` and
 * measured for in a real browser by `tools/verify-dock.mjs`.
 *
 * It also does not re-open the question the reading region settled. The fan is
 * still art, chip and cost: magnifying is a transform, so the container query
 * in `card.css` still sees the RESTING width and no ability band ever pops in
 * or out under the pointer. The hand says which cards you hold; the region says
 * what they do; the dock only makes the first of those easier to look at.
 */
function Hand({
  data,
  hand,
  cardWidth,
  handSize,
  zoom,
  play,
  drag,
}: {
  data: GameData;
  hand: readonly string[];
  cardWidth: number;
  handSize: number | null;
  zoom: Zoomer;
  play?: Play | undefined;
  drag?: Drag | undefined;
}) {
  const over = handSize !== null && hand.length > handSize;
  const held = play?.intent.k === 'hold' ? play.intent.card : null;
  const committed = new Set<string>(play?.commitments ?? []);
  // The contents rather than the count: drawing a card and discarding another
  // leaves the same number of slots in a different order, and every resting
  // anchor the dock holds is keyed to a position in that order.
  const dock = useHandDock(hand.join('|'), drag?.card == null);
  return (
    <div className="hand-strip">
      <h3 className="strip-title">
        Hand{' '}
        <em className={over ? 'over-limit' : undefined}>
          {hand.length}
          {handSize === null ? '' : ` / ${handSize}`}
          {over ? ' - discard at end of turn' : ''}
        </em>
      </h3>
      <div className="hand" ref={dock} onMouseLeave={() => zoom.clear()}>
        {hand.length === 0 && <p className="empty-note">No cards. Every visit costs one.</p>}
        {hand.map((id, i) => {
          const live = play?.live.hand.has(id) ?? false;
          const state = held === id ? ' is-held' : committed.has(id) ? ' is-picked' : '';
          return (
            <div
              key={`${id}-${i}`}
              className={`hand-card${state}${mark(play, live)}`}
              style={{ zIndex: i }}
              onMouseEnter={() => zoom.show(id)}
              onFocus={() => zoom.show(id)}
              onPointerDown={drag ? (e) => drag.start(id, e) : undefined}
              // A drag ends in a click too. `consumeClick` is what keeps the
              // release from picking the card straight back up (ticket 26).
              onClick={play ? () => !drag?.consumeClick() && play.hold(id) : undefined}
              role={play?.active ? 'button' : undefined}
              tabIndex={play?.active ? 0 : undefined}
              onKeyDown={
                play?.active
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') play.hold(id);
                    }
                  : undefined
              }
            >
              {/* No `card-readable` any more. At this width the printed text
                  would be mush, and the reading region is where it is read -
                  so the card drops its band and the hand becomes what it should
                  always have been: art, crop chip, cost. */}
              <Card face={printedFace(data, id)} width={cardWidth} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The printed hand size on this seat's Barn, whichever face is showing. */
export function handSizeOf(data: GameData, buildings: readonly BuildingView[]): number | null {
  const barn = buildings.find(
    (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'barn',
  );
  if (!barn) return null;
  return printedFace(data, barn.card, barn.upgraded).handSize;
}

/**
 * ⭐ A COUNT THAT MOVED, MARKED FOR ONE BEAT (phase 5).
 *
 * The research names "a count changing" as one of the two things worth
 * animating, and in this game the counts worth marking are your money and your
 * score - because the whole hook is that BOTH OF THEM MOVE ON SOMEBODY ELSE'S
 * TURN. A neighbour visiting your Notice Board mints you a coin from the bank
 * while you are not the one acting, which is precisely the moment a number can
 * change with nobody watching it.
 *
 * ⚠️ THE BEAT IS THE CSS ANIMATION'S OWN, NOT A TIMER. The flag is cleared by
 * `onAnimationEnd` rather than by a `setTimeout` matched to `--motion-state` by
 * hand, so the duration lives in exactly one place and the two cannot drift.
 * It also means the reduced-motion guard needs no second thought here: with the
 * animation switched off nothing is drawn, so a flag that never clears has
 * nothing to show.
 */
function useChanged(value: number): [boolean, () => void] {
  const [changed, setChanged] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
  }, [value]);
  return [changed, () => setChanged(false)];
}

export function Farm({
  data,
  view,
  buildingWidth,
  handWidth,
  barnWidth,
  zoom,
  play,
  drag,
  reading,
}: {
  data: GameData;
  view: PlayerView;
  buildingWidth: number;
  handWidth: number;
  /**
   * The barn pile, which USED TO BE `round(handWidth * 0.66)` and is now its own
   * token (`--card-barn`). Every shipped step's value is still exactly that
   * product, so nothing moved; what changed is that it stops growing above the
   * desktop step, because the hand and the barn share a row and a barn pile
   * scaled to a 300px hand would take the width the fan needs to stay unclipped.
   * The reasoning is written out in full beside the token in `base.css`.
   */
  barnWidth: number;
  zoom: Zoomer;
  play?: Play | undefined;
  drag?: Drag | undefined;
  /** The reading region, when the viewport has room for one. `Table.tsx`
      renders the floating overlay instead when it has not, in which case this
      is absent and the farm's second grid column collapses to nothing. */
  reading?: ReactNode;
}) {
  const meta = SUIT_META[view.you.suit];
  const yourTurn = view.turnPlayer === view.seat;
  const vp = receiptTotal(view.you.receipts);
  const [coinsMoved, coinsDone] = useChanged(view.you.coins);
  const [vpMoved, vpDone] = useChanged(vp);

  return (
    <section
      className={`farm${yourTurn ? ' farm-active' : ''}`}
      style={{ ['--seat-ink' as string]: meta.ink, ['--seat-pip' as string]: meta.pip }}
      aria-label="your farm"
    >
      <header className="farm-head">
        <img className="farm-crop" src={cropIcon(view.you.suit)} alt="" />
        <h2>Your {meta.label} farm</h2>
        <span
          className={`farm-coins${coinsMoved ? ' count-moved' : ''}`}
          title="coins are spend-only: they are not victory points"
          onAnimationEnd={coinsDone}
        >
          <img src={token('coin')} alt="" />£{view.you.coins}
        </span>
        <span
          className={`farm-vp${vpMoved ? ' count-moved' : ''}`}
          title="VP on the island receipts you hold"
          onAnimationEnd={vpDone}
        >
          <img src={frame('vp')} alt="" />
          {vp} VP
        </span>
        {yourTurn ? (
          <span className="farm-turn">your turn</span>
        ) : (
          <span className="farm-waiting">waiting</span>
        )}
      </header>

      <Tableau
        data={data}
        buildings={view.you.tableau}
        cardWidth={buildingWidth}
        zoom={zoom}
        play={play}
      />

      <div className="farm-strips">
        <Hand
          data={data}
          hand={view.you.hand}
          cardWidth={handWidth}
          handSize={handSizeOf(data, view.you.tableau)}
          zoom={zoom}
          play={play}
          drag={drag}
        />
        <Barn barn={view.you.barn} cardWidth={barnWidth} />
      </div>

      {reading}
    </section>
  );
}
