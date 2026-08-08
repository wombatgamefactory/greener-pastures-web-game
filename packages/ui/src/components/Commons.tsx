/**
 * The commons band: everything on the table that belongs to nobody.
 *
 * Five decks with their face-up discards, the Hiring Fair, the island, and the
 * Aerodrome when Vegetable is at the table. The decks are never merged and
 * never cross-shuffled, so they are shown as five separate spines with five
 * separate discards - the Draw action is "top of any two decks", and that only
 * reads if the five stay visibly apart.
 */

import type { GameData, Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { balloonArt } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import { seatSuits, workerTrack, workersOwnedBy } from '../view/table';
import { printedFace } from '../view/printed';
import { Card, CardBack } from './Card';
import { IslandPanel } from './Island';
import { WorkerPanel } from './Worker';
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
          <div onMouseEnter={() => zoom.show(top, false)}>
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
}: {
  data: GameData;
  view: PlayerView;
  cardWidth: number;
  islandTile: number;
  zoom: Zoomer;
  play?: Play | undefined;
}) {
  const suits = seatSuits(view);
  const yours = workersOwnedBy(view, view.seat);

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
        <h2 className="panel-title">The island</h2>
        <IslandPanel data={data} view={view} tileWidth={islandTile} play={play} />
      </div>

      <div className="commons-right">
        <div className="panel panel-fair">
          <h2 className="panel-title">
            Your Service <em>£{data.workers.ownerActivationCost}</em>
          </h2>
          <div className="fair">
            {/* One entry, always: every seat owns its suit's Service from setup
                and can never own another. The rivals' Services live on the rival
                rail, which is where the cross-table read belongs. */}
            {yours.map((w) => (
              <WorkerPanel
                key={w.id}
                track={workerTrack(data, w)}
                ownerLabel="yours"
                size="rail"
                play={play}
              />
            ))}
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
