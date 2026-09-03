/**
 * The commons band: everything on the table that belongs to nobody.
 *
 * Five decks with their face-up discards, the doors legend, the island, and the
 * Aerodrome when Vegetable is at the table. The decks are never merged and
 * never cross-shuffled, so they are shown as five separate spines with five
 * separate discards - the Draw action is "top of any two decks, keep both", and
 * that only reads if the five stay visibly apart.
 *
 * ⭐ THE HIRING FAIR PANEL BECAME THE DOORS LEGEND (v31). It used to print "Your
 * Service, GBP 2" over the one Service you owned, which is three deleted rules
 * in one caption. What sits there now is the five COLOURS and what each one
 * does, which is the single most-consulted fact in the v31 game and is consulted
 * for two different reasons at once: it is what a card on a farm's Notice Board
 * buys, and it is the key to every meeple on the island and in every supply.
 * All five are listed even at 2 seats, because a meeple of a colour nobody farms
 * still works.
 */

import type { GameData, Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { balloonArt } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import { allDoors, doorOwner, seatSuits } from '../view/table';
import { printedFace } from '../view/printed';
import { Card, CardBack } from './Card';
import { DoorChip } from './Door';
import { IslandPanel } from './Island';
import type { Zoomer } from './Zoom';

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
  return (
    <div
      className={`deck${mark(play, live)}`}
      onMouseLeave={() => zoom.clear()}
      onClick={live ? () => play?.deck(suit) : undefined}
      role={live ? 'button' : undefined}
      tabIndex={live ? 0 : undefined}
      onKeyDown={
        live
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') play?.deck(suit);
            }
          : undefined
      }
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
    </div>
  );
}

export function Commons({
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
    <section className="commons" aria-label="the commons">
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

      <div className="commons-right">
        <div className="panel panel-doors">
          <h2 className="panel-title">
            The five doors <em>and what a meeple of that colour does</em>
          </h2>
          <div className="doors">
            {allDoors(data).map((door) => {
              const seat = doorOwner(view, door.colour);
              return (
                <DoorChip
                  key={door.colour}
                  door={door}
                  owner={seat === null ? null : seatName(suits[seat], seat, view.seat)}
                  size="rail"
                  showMeeple
                />
              );
            })}
          </div>
        </div>

        {view.aerodrome && (
          <div className="panel panel-aerodrome">
            <h2 className="panel-title">Aerodrome</h2>
            <ul className="balloons">
              {view.aerodrome.balloons.map((balloon) => {
                const spec = data.aerodrome.balloons.find((b) => b.id === balloon.id);
                const parked =
                  balloon.at === 'centre'
                    ? 'in the centre, free to take'
                    : `parked at ${seatName(suits[balloon.at], balloon.at, view.seat)}`;
                const live = play?.live.balloons.has(balloon.id) ?? false;
                return (
                  <li
                    key={balloon.id}
                    className={mark(play, live).trim()}
                    title={`${spec?.rewardText ?? balloon.id} - ${parked}`}
                    onClick={live ? () => play?.balloon(balloon.id) : undefined}
                  >
                    <img src={balloonArt(balloon.id)} alt="" />
                    <span>{spec?.rewardText ?? balloon.id}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
