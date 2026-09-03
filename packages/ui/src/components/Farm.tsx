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
import { cropIcon, frame } from '../view/art';
import { dropZone } from '../view/drop';
import { clickCardPower } from '../view/intent';
import { cardName, describeMove } from '../view/moveText';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { displayOrder, liveThreshold, meepleCount, receiptTotal } from '../view/table';
import { Card, CardBack } from './Card';
import { StackGauge } from './StackGauge';
import { MeepleSupply } from './Supply';
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
  ownSeat,
}: {
  data: GameData;
  buildings: readonly BuildingView[];
  cardWidth: number;
  zoom: Zoomer;
  play?: Play | undefined;
  /**
   * ⭐ THE SELF-VISIT DOOR (v31). Present only on YOUR OWN tableau: passing the
   * seat is what turns this row's Notice Board into a visit target, and the
   * rival inspector passes nothing, so a neighbour's board can never grow the
   * affordance by accident.
   *
   * It is a badge on the card rather than a bar button for the same reason a
   * card power is: the board is the component the move is made on. What it must
   * NOT do is read like the rail's neighbour panels, because those two acts are
   * opposites - so it is labelled "your own door" and says out loud that it
   * fills your own board.
   */
  ownSeat?: number | undefined;
}) {
  return (
    <div className="tableau" onMouseLeave={() => zoom.clear()}>
      {displayOrder(data, buildings).map((b) => {
        const face = printedFace(data, b.card);
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
        const isBoard = data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard';
        const selfDoor =
          isBoard && ownSeat !== undefined && (play?.live.hosts.has(ownSeat) ?? false);
        const powerTitle =
          play && powers.length === 1
            ? describeMove(data, play.view, powers[0] as Move)
            : `${cardName(data, b.card)}: ${powers.length} ways to use it`;
        return (
          <div
            key={b.card}
            className={`building${full ? ' building-full' : ''}${mark(play, live)}`}
            {...(play ? dropZone('building', b.card) : {})}
            onMouseEnter={() => zoom.show(b.card)}
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
            {selfDoor && (
              /* Same `stopPropagation` argument as the power badge below: the
                 card under it is very often a sow or a harvest target at the
                 same moment, and a badge that also fired the card's own click
                 would be the one control on this screen that does two things. */
              <button
                type="button"
                className="building-selfdoor"
                title="Your own door: put a card here for your own suit's action. It counts toward your own threshold, so it clogs your board and shuts your neighbours out."
                onClick={(e) => {
                  e.stopPropagation();
                  play?.host(ownSeat as number);
                }}
              >
                your own door
              </button>
            )}
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
      {/* The Barn prints nothing at all since v31 - it is simply where cards
          ready for delivery are stored - so the caption is the only place that
          fact is said, and it says it. */}
      <h3 className="strip-title">
        Barn <em>{total} cards, for the island</em>
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
  handLimit,
  zoom,
  play,
  drag,
}: {
  data: GameData;
  hand: readonly string[];
  cardWidth: number;
  handLimit: number | null;
  zoom: Zoomer;
  play?: Play | undefined;
  drag?: Drag | undefined;
}) {
  const over = handLimit !== null && hand.length > handLimit;
  const held = play?.intent.k === 'hold' ? play.intent.card : null;
  const committed = new Set<string>(play?.commitments ?? []);
  // The contents rather than the count: drawing a card and discarding another
  // leaves the same number of slots in a different order, and every resting
  // anchor the dock holds is keyed to a position in that order.
  const dock = useHandDock(hand.join('|'), drag?.card == null);
  return (
    <div className="hand-strip">
      {/* ⭐ THE DENOMINATOR IS BACK (02/09/2026) AND IT IS NOT A CARD VALUE.
          It used to print "5 / 6" off the Barn's printed hand size; the limit
          is one global rule now (`rules.turn.handLimit`), the Barn prints
          nothing, and this strip is the only place on the table that shows it -
          which is why it also has to say WHEN the limit bites. A player who
          reads "13 / 12" and nothing else assumes the thirteenth card is
          illegal, and it is not: you may hold anything you like mid-turn and
          the overflow goes at the boundary. Hence the trailing clause, in the
          same #a2493a the clog flag wears. */}
      <h3 className="strip-title">
        Hand{' '}
        <em className={over ? 'over-limit' : undefined}>
          {hand.length}
          {handLimit === null ? ' cards' : ` / ${handLimit}`}
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

/**
 * ⭐ A COUNT THAT MOVED, MARKED FOR ONE BEAT (phase 5).
 *
 * The research names "a count changing" as one of the two things worth
 * animating, and in this game the counts worth marking are your MEEPLES and your
 * score - because the whole hook is that both of them move on somebody else's
 * turn. Your score moves when a neighbour takes the tile you were racing for;
 * your meeple count moves when your own delivery resolves inside a longer chain
 * of effects. Both are moments a number can change with nobody watching it.
 *
 * ⛔ It was your MONEY until v31. There is no money.
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
  const meeples = meepleCount(view.you.meeples);
  const [meeplesMoved, meeplesDone] = useChanged(meeples);
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
          className={`farm-meeples${meeplesMoved ? ' count-moved' : ''}`}
          title="meeples held: each is one free action, spent at the start of a turn, and it leaves the game"
          onAnimationEnd={meeplesDone}
        >
          {/* No pawn here, deliberately: the count is a TOTAL across colours
              and a single coloured pawn beside it would name a colour the number
              is not about. The colours are drawn immediately below, in the
              supply, where each one has its own count. */}
          {meeples} meeple{meeples === 1 ? '' : 's'}
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

      {/* ⭐ THE SUPPLY SITS BETWEEN THE HEADER AND THE TABLEAU, which is where
          the turn starts. Meeples are spent before the bonus and before the
          action, so the piece is above the things the rest of the turn acts on
          and the eye meets it in the order the rules do. */}
      <MeepleSupply data={data} meeples={view.you.meeples} play={play} turn={view.turn} />

      <Tableau
        data={data}
        buildings={view.you.tableau}
        cardWidth={buildingWidth}
        zoom={zoom}
        play={play}
        ownSeat={view.seat}
      />

      <div className="farm-strips">
        <Hand
          data={data}
          hand={view.you.hand}
          cardWidth={handWidth}
          handLimit={data.rules.turn.handLimit}
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
