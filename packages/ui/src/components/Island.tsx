/**
 * The island: the shared scoring structure and the game's clock.
 *
 * Built as the printed cut-off pyramid - the old Level 3 row on top, Level 1
 * along the bottom - with the tiles butted edge to edge, because the art is
 * drawn to tile that way (the bookend faces paint the sea at each row's ends).
 * Everything except the map itself is DOM over text-free art, the same as a
 * card: the tiles carry no printed VP, coins or crate slots.
 *
 * Since the flat island (2026-08-09) THE ROWS ARE DECORATION. Every tile costs
 * the same, pays the same and is deliverable at any time, so there is no level
 * label, no lock and no per-level gradient strip. The one gradient left is per
 * tile and is drawn where it belongs - on the empty receipt slots, which show
 * what arriving in that position pays. A slope you watch shrinking is pressure;
 * the same slope discovered at the moment it costs you is a hidden wall.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveriesPerTile, deliveryVp } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon, demandTokenLayers, islandTileArt } from '../view/art';
import { SUIT_META } from '../view/suits';

export type Level = 1 | 2 | 3;

/** The tile's printed row. Layout only - no rule reads it. */
export function levelOf(data: GameData, tile: string): Level {
  const spec = data.island.tiles.find((t) => t.id === tile);
  if (!spec) throw new Error(`Unknown island tile ${tile}`);
  return spec.level;
}

function DemandToken({
  demand,
  size,
  faceDown = false,
}: {
  demand: Suit | 'wild';
  size: number;
  faceDown?: boolean;
}) {
  // A face-down token pays like a cornucopia but is not one, and the label says
  // so: what a player needs to know is that this crate WAS a named crop and has
  // been opened - which is a different fact about the board from a crate the bag
  // dealt wild.
  const label = faceDown
    ? 'turned face down: any crop'
    : demand === 'wild'
      ? 'any crop (cornucopia)'
      : SUIT_META[demand].label;
  return (
    <span className="demand" style={{ width: `${size}px`, height: `${size}px` }} title={label}>
      {demandTokenLayers(demand, faceDown).map((src) => (
        <img key={src} src={src} alt="" />
      ))}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/**
 * The one thing every tile shares, said once instead of on each of twelve
 * identical tiles. This is the whole island rule in a line, which is the point
 * of the flat island.
 */
function IslandLegend({ data }: { data: GameData }) {
  const { crates, cardsPerCrate, coinsPerDelivery } = data.island.tileRule;
  const schedule = data.island.vpByDeliveryOrder;
  return (
    <p className="island-legend">
      Every tile: {crates} crates of {cardsPerCrate} &rarr; &pound;{coinsPerDelivery}.{' '}
      {schedule
        .map((vp, i) => `${i === 0 ? '1st' : i === 1 ? '2nd' : `${i + 1}th`} ${vp} VP`)
        .join(', ')}
      .
    </p>
  );
}

export function IslandPanel({
  data,
  view,
  tileWidth,
  play,
}: {
  data: GameData;
  view: PlayerView;
  tileWidth: number;
  play?: Play | undefined;
}) {
  const rows: Level[] = [3, 2, 1];
  const capacity = deliveriesPerTile(data);
  const { cardsPerCrate } = data.island.tileRule;
  const suitOf = (seat: Seat): Suit | undefined =>
    seat === view.seat ? view.you.suit : view.rivals.find((r) => r.seat === seat)?.suit;

  return (
    <div className="island" style={{ ['--island-tile' as string]: `${tileWidth}px` }}>
      {rows.map((level) => {
        const tiles = view.island.tiles.filter((t) => levelOf(data, t.tile) === level);
        if (tiles.length === 0) return null;
        return (
          <div key={level} className="island-row">
            <div className="island-tiles">
              {tiles.map((tile) => {
                const spent = tile.deliveredBy.length;
                const live = play?.live.tiles.has(tile.tile) ?? false;
                return (
                  <div
                    key={tile.tile}
                    className={`island-tile${spent >= capacity ? ' island-tile-done' : ''}${mark(
                      play,
                      live,
                    )}`}
                    onClick={live ? () => play?.tile(tile.tile) : undefined}
                    role={live ? 'button' : undefined}
                    tabIndex={live ? 0 : undefined}
                    onKeyDown={
                      live
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') play?.tile(tile.tile);
                          }
                        : undefined
                    }
                  >
                    <img className="island-art" src={islandTileArt(tile.tile)} alt="" />
                    <div className="island-demands">
                      {tile.crates.map((demand, i) => (
                        <span key={i} className="island-crate">
                          <DemandToken
                            demand={demand}
                            faceDown={tile.faceDown?.[i] === true}
                            size={Math.round(tileWidth * 0.34)}
                          />
                          <b data-text={String(cardsPerCrate)}>{cardsPerCrate}</b>
                        </span>
                      ))}
                    </div>
                    {/* A receipt says WHO, so a taken one carries the deliverer's
                        crop rather than the printed rosette: the token art is one
                        piece for every seat, and on the board the only question
                        anyone asks of a filled slot is whose it is. An untaken one
                        says WHAT IT PAYS, which is the whole race. */}
                    <div className="island-receipts">
                      {Array.from({ length: capacity }, (_, i) => {
                        const seat = tile.deliveredBy[i];
                        const suit = seat === undefined ? undefined : suitOf(seat);
                        const vp = deliveryVp(data, i);
                        return (
                          <span
                            key={i}
                            className={`receipt${seat === undefined ? ' receipt-empty' : ''}`}
                            style={suit ? { background: SUIT_META[suit].pip } : undefined}
                            title={
                              seat === undefined
                                ? `open delivery slot, worth ${vp} VP`
                                : `${suit ? SUIT_META[suit].label : `Seat ${seat}`} delivered here for ${vp} VP`
                            }
                          >
                            {suit ? <img src={cropIcon(suit)} alt="" /> : <i>{vp}</i>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <IslandLegend data={data} />
    </div>
  );
}
