/**
 * The shared table: everything laid out where nobody's farm reaches, but every
 * card here still has an owner or is about to get one.
 *
 * Five decks with their face-up discards, the Notice Board powers key and the
 * island. (The Aerodrome panel went with the balloons on 16/09/2026.) The decks
 * are never merged and never cross-shuffled, so they are shown as five separate
 * spines with five separate discards - the Draw action is "top of any two
 * decks, keep both", and that only reads if the five stay visibly apart.
 *
 * ⭐ FILE RENAMED FROM `Commons.tsx` TO `SharedTable.tsx` 25/09/2026 (B24): the
 * component itself was already called `SharedTable` (below), and the file name
 * was the one place the retired name still lingered. No behaviour change.
 *
 * ⭐ RENAMED FROM `Commons` 18/09/2026 (2.7.4). THE COMMONS - five Notice Boards
 * standing ownerless in the centre, each with a public face-up pile anyone
 * could play onto - was ruled DEAD on 13/09/2026 and its code deleted
 * (CLAUDE.md §5). This component never implemented that system; it always
 * drew the decks, the island and the legend. But it carried the system's NAME
 * regardless (`Commons`, `aria-label="the commons"`, `.commons`), which reads
 * as a leftover of the thing that died rather than what this band has always
 * actually been, so the name is retired along with the system it borrowed it
 * from. Nothing about what this component draws changes with the rename.
 *
 * ⭐ THE DOORS LEGEND BECAME THE NOTICE BOARD POWERS KEY (18/09/2026, 2.7.3). It
 * used to print `allDoors`/`doorOf`'s text, which is the WORKER's plain action
 * ("Deliver.") - correct for what a spent meeple does, wrong for what a visit
 * buys since the five boards print their own, longer, amplified powers (S12).
 * `boardPowers` below reads `abilityText` straight off each `noticeboard`-slot
 * card in `cards.json` instead, so this legend is now specifically what a card
 * on that colour's Notice Board is worth - the single most-consulted fact in
 * the shipped game. All five are listed even at 2 seats, where only two or
 * three are farmed - the unfarmed ones read "nobody farms this crop" rather
 * than being dropped, because a two-player table can still draw either of them
 * as its second board (the two-board fix).
 */

import type { GameData, Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cardName } from '../view/moveText';
import { SUIT_META, seatName } from '../view/suits';
import { doorOf, doorOwner, seatSuits } from '../view/table';
import type { Door } from '../view/table';
import { printedFace } from '../view/printed';
import { Card, CardBack } from './Card';
import { DoorChip } from './Door';
import { IslandPanel } from './Island';
import type { Zoomer } from './Zoom';

/**
 * The five Notice Board powers, as `Door` objects so the legend can still be
 * drawn by `DoorChip` - but with `actionText` overridden to the BOARD's own
 * printed sentence (`abilityText`, off the `noticeboard`-slot card) rather
 * than `doorOf`'s worker-action text.
 *
 * ⚠️ THE VERB IS OVERRIDDEN TOO, and that is not cosmetic. `doorOf` names the
 * PLAIN action a Worker of that colour buys, which is not always the verb the
 * BOARD's power performs. Apiary is the case in point: Dean retexted the
 * Apiary board on 14/09/2026 from "Sow 2 cards from your hand onto your
 * buildings" to "Grow a building using the top card of any deck", so the board
 * Grows while `doorOf`'s roster entry still says `sow`. Reading the verb off
 * `doorOf` printed "Sow" on the most-consulted legend in the game, naming a
 * keyword this board no longer uses. SOW and GROW are different keywords here:
 * a sow places a card of any suit without activating, a Grow activates and
 * fires the ability. `BOARD_VERB` is keyed to what each board's printed power
 * actually does, so the legend cannot drift from the card faces again.
 */
const BOARD_VERB: Readonly<Record<Suit, string>> = {
  wheat: 'Harvest',
  vegetable: 'Deliver',
  orchard: 'Draw',
  apiary: 'Grow',
  dairy: 'Build',
};

function boardPowers(data: GameData): Door[] {
  return data.workers.roster
    .map((spec) => {
      const board = data.cards.catalogue.find(
        (c) => c.slot === 'noticeboard' && c.suit === spec.linkedSuit,
      );
      if (!board) return null;
      return {
        ...doorOf(data, spec.linkedSuit),
        actionText: board.abilityText,
        actionLabel: BOARD_VERB[spec.linkedSuit],
      };
    })
    .filter((door): door is Door => door !== null);
}

/**
 * B23, 25/09/2026: THE DECK POPOVER.
 *
 * The discard's top card was already drawn here, permanently, at deck size -
 * but deck size is 62-138px across the ladder (`--card-deck`, `base.css`) and
 * a card that small is a picture to glance at, not something you can read the
 * printed text off. And the whole element was only ever reachable when it was
 * LIVE (`tabIndex={live ? 0 : undefined}`, same bug as the rival Notice Board
 * buttons item 4 of this pass fixes): a deck you were not about to draw from
 * this turn - which is most decks, most turns - could not be tabbed to at
 * all, so its count and its discard were mouse-and-hover only.
 *
 * Every deck is now focusable, live or not (`aria-disabled` carries the
 * legal/illegal distinction the way item 4's board buttons do), and hovering
 * or focusing it opens a small text popover naming BOTH facts together - how
 * many cards are left, and what the top discard is - rather than leaving a
 * player to infer the count from a printed corner numeral and the discard
 * from a thumbnail. `discard` is public state (`PlayerView.discards`), so
 * nothing here crosses the hidden-information boundary the view type
 * enforces.
 */
function DeckSpine({
  data,
  suit,
  count,
  discard,
  width,
  zoom,
  play,
}: {
  data: GameData;
  suit: Suit;
  count: number;
  discard: readonly string[];
  width: number;
  zoom: Zoomer;
  play?: Play | undefined;
}) {
  const top = discard[discard.length - 1];
  const live = play?.live.decks.has(suit) ?? false;
  const label = `${SUIT_META[suit].label} deck: ${count} card${count === 1 ? '' : 's'} left. ${
    top ? `Top of discard: ${cardName(data, top)}.` : 'Discard pile empty.'
  }`;
  const activate = () => play?.deck(suit);
  return (
    <div
      className={`deck${mark(play, live)}`}
      onMouseLeave={() => zoom.clear()}
      onClick={live ? activate : undefined}
      role="button"
      aria-disabled={!live}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (live && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          activate();
        }
      }}
    >
      <CardBack suit={suit} width={width} count={count} />
      <div className="deck-discard">
        {top ? (
          <div onMouseEnter={() => zoom.show(top)}>
            <Card face={printedFace(data, top)} width={width} />
          </div>
        ) : (
          <div className="deck-empty" style={{ width: `${width}px` }} aria-label="empty discard" />
        )}
        <span className="deck-label" style={{ color: SUIT_META[suit].ink }}>
          {SUIT_META[suit].label}
        </span>
      </div>
      {/* The popover itself: CSS-only reveal on hover or focus (`shared-
          table.css`), so it works identically for a pointer and for a
          keyboard user tabbing onto the deck - neither needs JavaScript state
          to see it, only `:hover`/`:focus-visible`. `aria-hidden` because the
          `aria-label` above already carries the same words to a screen
          reader the moment the deck itself receives focus; this is the
          sighted reading of that same fact. */}
      <div className="deck-popover" aria-hidden="true">
        <strong>{SUIT_META[suit].label}</strong>
        <span>
          {count} card{count === 1 ? '' : 's'} left
        </span>
        <span>{top ? `Top of discard: ${cardName(data, top)}` : 'Discard pile empty'}</span>
      </div>
    </div>
  );
}

export function SharedTable({
  data,
  view,
  cardWidth,
  islandTile,
  zoom,
  play,
  onExpandIsland,
}: {
  data: GameData;
  view: PlayerView;
  cardWidth: number;
  islandTile: number;
  zoom: Zoomer;
  play?: Play | undefined;
  /** Opens the full-size island. Owned by `Table.tsx`, like the inspector. */
  onExpandIsland?: (() => void) | undefined;
}) {
  const suits = seatSuits(view);

  return (
    <section className="shared-table" aria-label="the shared table">
      <div className="panel panel-decks">
        <h2 className="panel-title">Decks</h2>
        <div className="decks">
          {view.suitsInPlay.map((suit) => (
            <DeckSpine
              key={suit}
              data={data}
              suit={suit}
              count={view.decks[suit] ?? 0}
              discard={view.discards[suit] ?? []}
              width={cardWidth}
              zoom={zoom}
              play={play}
            />
          ))}
        </div>
        {/* T10b (26/09/2026): the task tray's host. `Prompt.tsx` portals a
            live task's cards and answers in here, under the deck backs and
            clear of them (`shared-table.css`, `.task-tray`), so a task never
            reflows the farm and never covers a deck it is asking about. Empty
            and click-through on every other turn. */}
        {play && <div className="task-tray" id="task-tray" />}
      </div>

      <div className="panel panel-island">
        {/*
         * ⚠️ THE BUTTON IS THE TITLE, and that is a layout decision as much as
         * an accessibility one. The map click is the gesture a mouse reaches
         * for, but it is invisible and unreachable from a keyboard, so the
         * feature needs a real control - and every other place to put one (a
         * chip beside the legend, a corner affordance) adds a row to a panel
         * whose height the farm's slack is measured against. Wrapping the
         * caption that is already there costs nothing at all.
         */}
        <h2 className="panel-title">
          <button
            type="button"
            className="island-expand"
            onClick={onExpandIsland}
            title="See the island at full size"
          >
            The island <span aria-hidden="true">&#8599;</span>
          </button>
        </h2>
        <IslandPanel
          data={data}
          view={view}
          tileWidth={islandTile}
          play={play}
          onExpand={onExpandIsland}
        />
      </div>

      <div className="shared-table-right">
        <div className="panel panel-doors">
          <h2 className="panel-title">The five Notice Board powers</h2>
          <div className="doors">
            {boardPowers(data).map((door) => {
              const seat = doorOwner(view, door.colour);
              return (
                <DoorChip
                  data={data}
                  key={door.colour}
                  door={door}
                  owner={seat === null ? null : seatName(suits[seat], seat, view.seat)}
                  size="rail"
                  showMeeple={false}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
