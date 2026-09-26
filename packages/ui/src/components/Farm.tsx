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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { GameData, Suit } from '@gp/data';
import type { BuildingView, Move, PlayerView, Receipt } from '@gp/engine';

import { useHandDock } from '../session/dock';
import type { Drag } from '../session/drag';
import { mark } from '../session/play';
import type { Play } from '../session/play';
import { useRovingTabIndex } from '../session/rovingTabIndex';
import { cropIcon, frame } from '../view/art';
import { dropZone } from '../view/drop';
import { clickCardPower } from '../view/intent';
import { cardName, describeMove } from '../view/moveText';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { previewBox, spreadShifts } from '../view/handSpread';
import type { PreviewBox } from '../view/handSpread';
import { fitTableau } from '../view/tableauFit';
import type { TableauFit } from '../view/tableauFit';
import { displayOrder, liveThreshold, meepleCount, receiptTotal } from '../view/table';
import { Card, CardBack } from './Card';
import { FillBar, StackGauge } from './StackGauge';
import { MeepleSupply } from './Supply';
import type { Zoomer } from './Zoom';

/**
 * B19, 25/09/2026: roving tabindex for a row of cards read by keyboard.
 *
 * Before this, only a LIVE building or hand card carried a `tabIndex` at all
 * (`tabIndex={live ? 0 : undefined}`), so a keyboard user landing on the
 * tableau or the hand could reach the cards they could act on and nothing
 * else - reading what a rival has built, or what is in a hand between turns,
 * was mouse-and-hover only (the appraisal's accessibility finding: "non-live
 * buildings and hand cards are not focusable, so a keyboard user cannot read a
 * card").
 *
 * Every card in the group is now reachable, but only ONE at a time sits in the
 * page's Tab order (the WAI-ARIA "roving tabindex" pattern for a
 * one-dimensional widget): Tab moves past the whole row in one stop, and the
 * arrow keys move which card is current, same as a native `<select>` or a
 * radio group. Activation is untouched by any of this - it still only exists
 * on a live card, gated where it always was (`onClick`/Enter-Space below).
 *
 * ⭐ MOVED TO `session/rovingTabIndex.ts`, 25/09/2026 (WP1b item 4): the rival
 * rail's Notice Board buttons need the exact same behaviour (see the dated
 * note in `RivalRail.tsx`), so the hook lives where both files can import it
 * rather than being copied. This banner is kept here because the reasoning is
 * still the reasoning for using it on THIS row; the implementation is next
 * door.
 */

/**
 * T10b (26/09/2026): THE MEASURING HALF OF `fitTableau` (`view/tableauFit.ts`,
 * which carries the whole argument - QA D1, buildings cut in half at 1600x900).
 *
 * WHAT "THE ROOM" IS, AND WHY IT IS NOT JUST THE TABLEAU'S OWN HEIGHT. The
 * farm hugs its content (`farm.css`, `align-self: start` capped at the row),
 * so the tableau's box is as tall as its buildings make it - measuring that
 * and sizing the buildings from it would be circular. The room is instead the
 * main column's bottom edge, less the farm's top, less everything in the farm
 * that is NOT the tableau: none of those depend on the buildings, so the
 * answer is the same whether the farm is hugging or capped, and resizing the
 * buildings to it cannot feed back into it.
 *
 * Re-measured whenever the farm or the column changes size (a window resize,
 * the turn bar, a new card in hand) and whenever the building count or the
 * ladder rung changes. A layout effect, so the fitted size is on screen in the
 * same frame the farm first paints - there is never a sliced first frame.
 */
function useTableauFit(
  ref: RefObject<HTMLDivElement | null>,
  n: number,
  ladder: number,
): TableauFit {
  const [fit, setFit] = useState<TableauFit>({ width: ladder, scrollRows: null });
  useLayoutEffect(() => {
    const tableau = ref.current;
    const farm = tableau?.closest<HTMLElement>('.farm');
    const column = farm?.parentElement;
    if (!tableau || !farm || !column) return;
    const measure = () => {
      const col = column.getBoundingClientRect();
      const cs = getComputedStyle(column);
      const bottom =
        col.bottom - Number.parseFloat(cs.paddingBottom) - Number.parseFloat(cs.borderBottomWidth);
      const box = farm.getBoundingClientRect();
      const own = tableau.getBoundingClientRect();
      const ts = getComputedStyle(tableau);
      const padY = Number.parseFloat(ts.paddingTop) + Number.parseFloat(ts.paddingBottom);
      const padX = Number.parseFloat(ts.paddingLeft) + Number.parseFloat(ts.paddingRight);
      const room = Math.floor(bottom - box.top - (box.height - own.height) - padY);
      const next = fitTableau(n, ladder, tableau.clientWidth - padX, room);
      setFit((prev) =>
        prev.width === next.width && prev.scrollRows === next.scrollRows ? prev : next,
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(farm);
    watch.observe(column);
    return () => watch.disconnect();
  }, [ref, n, ladder]);
  return fit;
}

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
  ownSuit,
  fit = false,
}: {
  data: GameData;
  buildings: readonly BuildingView[];
  cardWidth: number;
  zoom: Zoomer;
  play?: Play | undefined;
  /**
   * T10b (26/09/2026): size the buildings to the room the farm has
   * (`useTableauFit`). Your own farm only; the rival inspector is a scrolling
   * overlay with its own sizes and passes nothing.
   */
  fit?: boolean;
  /**
   * ⭐ THE SPARE-BOARD LABEL (S8, 13/09/2026). Only needs to know whose FARM
   * this is, to compare a board's printed suit against it, so `Inspector.tsx`
   * can pass this too and label a RIVAL's spare board the same way.
   */
  ownSuit?: Suit | undefined;
}) {
  const ordered = displayOrder(data, buildings);
  const rove = useRovingTabIndex(ordered.length);
  const box = useRef<HTMLDivElement | null>(null);
  const fitted = useTableauFit(box, fit ? ordered.length : 0, cardWidth);
  const width = fit ? fitted.width : cardWidth;
  const scrollRows = fit ? fitted.scrollRows : null;
  return (
    <div
      ref={box}
      className={`tableau${scrollRows === null ? '' : ' tableau-scroll'}`}
      style={scrollRows === null ? undefined : { ['--tableau-rows' as string]: scrollRows }}
      // A sideways scroller is a region a keyboard user must be told about.
      {...(scrollRows === null
        ? {}
        : { role: 'region', 'aria-label': 'your buildings, scroll sideways for more' })}
      onMouseLeave={() => zoom.clear()}
    >
      {ordered.map((b, i) => {
        const face = printedFace(data, b.card);
        // The enforced threshold, not the printed one - the gauge and the "full"
        // flag say when this building has clogged, and the engine is the
        // authority on that. See `liveThreshold` in view/table.ts.
        const threshold = liveThreshold(data, b.card, face.threshold);
        const isBoard = data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard';
        // ⭐ A NOTICE BOARD NEVER CLOGS (S8, 13/09/2026): `3+` is a harvest
        // minimum, never a maximum, so it never earns the "full"/clog styling
        // an ordinary building does at its threshold. It gets its own fill
        // reading below instead (`FillBar`, the same one the rail and the
        // inspector use), which says "3+" and never "full".
        const full = !isBoard && threshold !== null && b.stack.length >= threshold;
        const live = play?.live.buildings.has(b.card) ?? false;
        // Read off the engine's own list, like every other affordance here. A
        // card with nothing standing draws no badge, so the badge appearing IS
        // the news, and there is never a dead one to learn to ignore.
        const powers = play?.active ? clickCardPower(play.moves, b.card) : [];
        // ⭐ THE SPARE BOARD (S8, 13/09/2026): at two players a farm lays out a
        // second Notice Board, drawn at random from an unfarmed suit. Its owner
        // harvests it and banks every fee paid onto it, but can never press its
        // power - that is a rival's to take. A card of a different suit sitting
        // on a Notice Board is not a mistake to flag; here it is the printed
        // rule, so the badge says so rather than leaving a player to wonder
        // why their own suit's board is the other one along the row.
        const isSpareBoard = isBoard && ownSuit !== undefined && face.suit !== ownSuit;
        const powerTitle =
          play && powers.length === 1
            ? describeMove(data, play.view, powers[0] as Move)
            : `${cardName(data, b.card)}: ${powers.length} ways to use it`;
        return (
          <div
            key={b.card}
            data-card={b.card}
            ref={rove.setRef(i)}
            className={`building${full ? ' building-full' : ''}${mark(play, live)}`}
            {...(play ? dropZone('building', b.card) : {})}
            onMouseEnter={() => zoom.show(b.card)}
            onFocus={() => {
              rove.setActive(i);
              zoom.show(b.card);
            }}
            onClick={live ? () => play?.building(b.card) : undefined}
            role={live ? 'button' : undefined}
            // B19, 25/09/2026: every card is in reach (roving tabindex, see the
            // dated note above `useRovingTabIndex`); only a LIVE one still does
            // anything when you press it, unchanged from before.
            tabIndex={i === rove.activeIndex ? 0 : -1}
            onKeyDown={(e) => {
              rove.onKeyDown(i)(e);
              if (live && (e.key === 'Enter' || e.key === ' ')) play?.building(b.card);
            }}
          >
            <Card face={face} width={width} />
            <div className="building-gauge">
              {isBoard && threshold !== null ? (
                // The board reads through the same bar the rail and the
                // inspector use for a rival's board (`view/table.ts`
                // `noticeBoardOf`/`noticeBoardsOf`), so your own farm and a
                // neighbour's never disagree about what "3+" looks like.
                <FillBar filled={b.stack.length} threshold={threshold} />
              ) : (
                <StackGauge stack={b.stack} threshold={threshold} />
              )}
            </div>
            {full && <span className="building-clog">full</span>}
            {isSpareBoard && (
              <span
                className="building-spareboard"
                title="Drawn at random for a two-player game (S8): every fee paid here is yours to harvest, but you can never use its printed power yourself - that belongs to whoever visits it."
              >
                spare board
              </span>
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
      {/* ⭐ 10/09/2026: THE BARN PRINTS SOMETHING AGAIN - the own-crop end-game
          scorer moved here off the Farmstead (ledger A105; see `Farmstead`
          below and `Zoom.tsx`'s idle default, which now reads THIS card). This
          strip still shows the held pile, not the printed rule - a player
          reads the rule off the card itself in the tableau row above, the same
          way they read any other building's text - so the caption's job stays
          what it always was: naming what the pile is FOR. */}
      <h3 className="strip-title">
        Barn <em>{total} cards, for the island</em>
      </h3>
      <div className="barn-piles">
        {entries.length === 0 && <p className="empty-note">Empty. The island needs feeding.</p>}
        {entries.map(([suit, n]) => (
          <div
            key={suit}
            // The engine gives the UI a per-suit count, never individual barn
            // card ids, so there is no real card id a motion layer could
            // target for "the card that just landed here" - this pile-level
            // key is the nearest stable hook (25/09/2026, day-one scaffolding).
            data-card={`barn-${suit}`}
            className="barn-pile"
            title={`${n} ${SUIT_META[suit].label} in the barn`}
          >
            <CardBack suit={suit} width={cardWidth} count={n} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Your Farmstead: SIX PRINTED SLOTS holding your island receipt tokens.
 *
 * It prints no rules text of its own since the own-crop scorer moved to the
 * Barn on 10/09/2026 (see `Barn` above and `Zoom.tsx`) - "Store Receipts here.
 * Collect 6 to trigger end of the game" is what is left, and this strip is
 * that sentence made concrete: six slots, filled left to right in arrival
 * order, because a full Farmstead is the end trigger every seat's own count
 * has to make legible at a glance.
 *
 * Reuses the `.chip`/`.chip-muted` styling `Result.tsx` already established
 * for a filled-vs-empty slot, rather than inventing a third look for the same
 * idea.
 */
/*
 * B22, 25/09/2026: the receipt icon used to be `Math.round(cardWidth * 0.18)`
 * (`cardWidth` was the HAND card width), so it read about 12px at 1600 and
 * about 55px at 2560 - a receipt icon has nothing to do with how wide the hand
 * fan is. `--token` (`base.css`) is the fixed, per-step token size every other
 * token-shaped thing on the table is now measured against; `farmstead-icon` in
 * `farm.css` reads it, so the width is CSS's to own, not a prop computed here.
 */
function Farmstead({ receipts }: { receipts: readonly Receipt[] }) {
  const slots = Array.from({ length: 6 }, (_, i) => receipts[i] ?? null);
  return (
    <div className="farmstead">
      <h3 className="strip-title">
        Farmstead <em>{receipts.length} / 6 receipts</em>
      </h3>
      <div className="farmstead-slots">
        {slots.map((r, i) => (
          <span
            key={i}
            className={`chip${r ? '' : ' chip-muted'}`}
            title={
              r
                ? `${r.vp} VP, ${r.crop === 'wild' ? 'a wild token' : `a ${SUIT_META[r.crop].label} token`}`
                : 'Empty slot'
            }
          >
            {r ? (
              <>
                <img className="farmstead-icon" src={cropIcon(r.crop)} alt="" />
                <b>{r.vp}</b>
              </>
            ) : (
              <span aria-hidden="true">-</span>
            )}
          </span>
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
  /*
   * ⭐ 26/09/2026 (Dean): "when you hover over a card in your hand I want it to
   * become 3 times bigger and show all the rendered card details." The dock
   * magnifier could only grow a card as far as the headroom above the hand
   * allowed, and at that size the ability band stays hidden. So the dock is
   * switched off (the slots rest in their row) and the hovered or focused
   * card is drawn again as a full, readable card at three times the hand
   * width, floating just above it (`HandPreview`). It takes no clicks, so the
   * card under it is still the thing you click or drag.
   */
  const dock = useHandDock(hand.join('|'), false);
  const rove = useRovingTabIndex(hand.length);
  const [preview, setPreview] = useState<{
    id: string;
    box: PreviewBox;
    shifts: readonly number[];
  } | null>(null);
  /*
   * 26/09/2026 (Dean): the other cards slide left and right out from under
   * the preview, so the whole hand stays in view. Measured from the SLOTS,
   * which never move (only the drawn card inside each is shifted), so the
   * layout depends on which card is hovered and nothing else, and moving the
   * pointer along the row scrubs through the hand without flicker. The card
   * previewed is always the slot under the pointer, so it is what a click or
   * a drag takes.
   */
  const showPreview = (id: string, index: number) => {
    zoom.show(id);
    const handEl = dock.current;
    if (!handEl) return;
    const slots = Array.from(handEl.querySelectorAll<HTMLElement>(':scope > .hand-card'));
    const rect = slots[index]?.getBoundingClientRect();
    if (!rect) return;
    const strip = (handEl.parentElement ?? handEl).getBoundingClientRect();
    const boundL = strip.left;
    const boundR = Math.min(strip.right, window.innerWidth - 8);
    const box = previewBox({
      cardLeft: rect.left,
      cardTop: rect.top,
      cardWidth,
      boundL,
      boundR,
      viewportH: window.innerHeight,
    });
    const shifts = spreadShifts({
      lefts: slots.map((el) => el.getBoundingClientRect().left),
      cardWidth,
      hovered: index,
      preview: box,
      boundL,
      boundR,
    });
    setPreview({ id, box, shifts });
  };
  const dragging = drag?.card != null;
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
      <div
        className="hand"
        ref={dock}
        onMouseLeave={() => {
          zoom.clear();
          setPreview(null);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPreview(null);
        }}
      >
        {hand.length === 0 && <p className="empty-note">No cards. Every visit costs one.</p>}
        {hand.map((id, i) => {
          const live = play?.live.hand.has(id) ?? false;
          const state = held === id ? ' is-held' : committed.has(id) ? ' is-picked' : '';
          return (
            <div
              key={`${id}-${i}`}
              data-card={id}
              ref={rove.setRef(i)}
              className={`hand-card${state}${mark(play, live)}`}
              style={{ zIndex: i }}
              onMouseEnter={() => showPreview(id, i)}
              onFocus={() => {
                rove.setActive(i);
                showPreview(id, i);
              }}
              onPointerDown={drag ? (e) => drag.start(id, e) : undefined}
              // A drag ends in a click too. `consumeClick` is what keeps the
              // release from picking the card straight back up (ticket 26).
              onClick={play ? () => !drag?.consumeClick() && play.hold(id) : undefined}
              role={play?.active ? 'button' : undefined}
              // B19, 25/09/2026: focusable for reading whether or not it is your
              // turn (roving tabindex, see the dated note on
              // `useRovingTabIndex`); Enter/Space still only picks the card up
              // when `play.active`, unchanged from before.
              tabIndex={i === rove.activeIndex ? 0 : -1}
              onKeyDown={(e) => {
                rove.onKeyDown(i)(e);
                if (play?.active && (e.key === 'Enter' || e.key === ' ')) play.hold(id);
              }}
            >
              {/* No `card-readable` any more. At this width the printed text
                  would be mush, and the reading region is where it is read -
                  so the card drops its band and the hand becomes what it should
                  always have been: art, crop chip, cost. */}
              <div
                className="hand-card-shift"
                style={
                  preview !== null && !dragging && preview.id !== id
                    ? { transform: `translateX(${preview.shifts[i] ?? 0}px)` }
                    : undefined
                }
              >
                <Card face={printedFace(data, id)} width={cardWidth} />
              </div>
            </div>
          );
        })}
      </div>
      {preview !== null && !dragging && hand.includes(preview.id) && (
        <HandPreview data={data} id={preview.id} box={preview.box} />
      )}
    </div>
  );
}

/**
 * The hovered hand card, drawn full and readable at up to three times its hand
 * width (26/09/2026). Portalled to the body so no farm panel clips it. Its box
 * comes from `previewBox` (`view/handSpread.ts`): top level with the hand's
 * top, centred on the card it enlarges, shrinking to fit the room below.
 */
function HandPreview({ data, id, box }: { data: GameData; id: string; box: PreviewBox }) {
  return createPortal(
    <div
      className="hand-preview"
      style={{ left: box.left, top: box.top, width: box.width }}
      aria-hidden="true"
    >
      <Card face={printedFace(data, id)} width={box.width} zoomTier className="card-readable" />
    </div>,
    document.body,
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
      /* `--seat-edge` (25/09/2026, WP2 coordination): the 3:1-or-better hue for
         the farm's top border and anything else in farm.css that draws a
         boundary rather than a dot - `--seat-pip` alone is near-invisible on
         paper for Wheat and Dairy since their pips moved to the ruled action
         colours. */
      style={{
        ['--seat-ink' as string]: meta.ink,
        ['--seat-pip' as string]: meta.pip,
        ['--seat-edge' as string]: meta.edge,
      }}
      aria-label="your farm"
    >
      <header className="farm-head">
        <img className="farm-crop" src={cropIcon(view.you.suit)} alt="" />
        <h2>Your {meta.label} farm</h2>
        <span
          className={`farm-meeples${meeplesMoved ? ' count-moved' : ''}`}
          title={
            meeples === 0
              ? 'No Workers yet. Every island delivery brings one: deliver to the island and take the Worker with it.'
              : 'Workers held: each is one free action, spent after your main action and at most one a turn, and it then leaves the game'
          }
          onAnimationEnd={meeplesDone}
        >
          {/* No pawn here, deliberately: the count is a TOTAL across colours
              and a single coloured pawn beside it would name a colour the number
              is not about. The colours are drawn immediately below, in the
              supply, where each one has its own count. */}
          {meeples} Worker{meeples === 1 ? '' : 's'}
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
      {/* T10b (26/09/2026): ONLY WHEN YOU HOLD A WORKER. With none, the strip
          was a 50px dashed box saying "None yet" - the third place the screen
          said "no Workers" (the head chip beside your name and the turn bar's
          Worker zone are the other two, and both still do, with the "every
          island delivery brings one" sentence as their tooltip). Those 50px
          were a third of every building at 1600x900 (QA D1). The strip comes
          back the moment a delivery brings a Worker, which is also the moment
          it has something to click. */}
      {meeples > 0 && (
        <MeepleSupply data={data} meeples={view.you.meeples} play={play} turn={view.turn} />
      )}

      <Tableau
        data={data}
        buildings={view.you.tableau}
        cardWidth={buildingWidth}
        zoom={zoom}
        play={play}
        ownSuit={view.you.suit}
        fit
      />

      {/* The Farmstead's six slots, between the tableau and the hand/barn row:
          it holds nothing you can act on this turn (it is never a target of
          anything), so it does not compete with the strips below for the
          "what can I do right now" reading - it is the one strip that answers
          "how close am I to ending the game" instead. */}
      <Farmstead receipts={view.you.receipts} />

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
