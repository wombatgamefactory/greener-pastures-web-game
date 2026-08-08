/**
 * The island: the shared scoring structure and the game's clock.
 *
 * Built as the printed cut-off pyramid - Level 3 on top, Level 1 along the
 * bottom - with the tiles butted edge to edge, because the art is drawn to tile
 * that way (the bookend faces paint the sea at each row's ends). Everything
 * except the map itself is DOM over text-free art, the same as a card: the
 * tiles carry no printed VP, coins or crate slots.
 *
 * The panel also shows the LEVEL GATE (ticket 07/29), which is per-seat and is
 * otherwise invisible: you may deliver to a level only while already holding a
 * receipt from the level below. That is derivable from the view - the tiles
 * record who delivered where - so it is shown rather than left to be discovered
 * by a move that is not offered.
 */

import type { GameData, Suit } from '@gp/data';
import type { IslandState, PlayerView, Seat } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon, demandTokenLayers, islandTileArt } from '../view/art';
import { SUIT_META } from '../view/suits';

export type Level = 1 | 2 | 3;

export function levelOf(data: GameData, tile: string): Level {
  const spec = data.island.tiles.find((t) => t.id === tile);
  if (!spec) throw new Error(`Unknown island tile ${tile}`);
  return spec.level;
}

/** Levels this seat may deliver to now. Mirrors the engine's `openLevels`. */
export function openLevels(data: GameData, island: IslandState, seat: Seat): Set<Level> {
  if (!data.island.levelGate) return new Set<Level>([1, 2, 3]);
  const held = new Set<Level>();
  for (const tile of island.tiles) {
    if (tile.deliveredBy.includes(seat)) held.add(levelOf(data, tile.tile));
  }
  const open = new Set<Level>([1]);
  if (held.has(1)) open.add(2);
  if (held.has(2)) open.add(3);
  return open;
}

function DemandToken({ demand, size }: { demand: Suit | 'wild'; size: number }) {
  const label = demand === 'wild' ? 'any crop (cornucopia)' : SUIT_META[demand].label;
  return (
    <span className="demand" style={{ width: `${size}px`, height: `${size}px` }} title={label}>
      {demandTokenLayers(demand).map((src) => (
        <img key={src} src={src} alt="" />
      ))}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/**
 * The time gradient, shown as the queue it is: every bonus the level started
 * with, the taken ones struck through and the next one live. This is the whole
 * point of the device - a slope you watch shrinking is pressure, the same slope
 * discovered at the moment it costs you is a hidden wall - so it renders even
 * when the level is fully spent, and renders nothing only when the knob is off.
 */
function FillOrderBonus({
  data,
  seats,
  tiles,
}: {
  data: GameData;
  seats: number;
  tiles: readonly IslandState['tiles'][number][];
}) {
  const queue = data.island.fillOrderBonusBySeats[String(seats)] ?? [];
  if (queue.length === 0) return null;
  const made = tiles.reduce((n, t) => n + t.deliveredBy.length, 0);
  return (
    <span
      className="island-bonus"
      title={
        made < queue.length
          ? `The next delivery to this level takes +${queue[made]} VP. Bonuses left: ${queue
              .slice(made)
              .map((b) => `+${b}`)
              .join(', ')}`
          : 'Every early-delivery bonus on this level has gone'
      }
    >
      {queue.map((bonus, i) => (
        <b key={i} className={i < made ? 'island-bonus-spent' : undefined}>
          +{bonus}
        </b>
      ))}
    </span>
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
  const open = openLevels(data, view.island, view.seat);
  const rows: Level[] = [3, 2, 1];
  const suitOf = (seat: Seat): Suit | undefined =>
    seat === view.seat ? view.you.suit : view.rivals.find((r) => r.seat === seat)?.suit;

  return (
    <div className="island" style={{ ['--island-tile' as string]: `${tileWidth}px` }}>
      {rows.map((level) => {
        const rule = data.island.levelRules[String(level)];
        const tiles = view.island.tiles.filter((t) => levelOf(data, t.tile) === level);
        if (tiles.length === 0) return null;
        return (
          <div key={level} className={`island-row${open.has(level) ? ' island-row-open' : ''}`}>
            <span
              className="island-level"
              title={
                open.has(level)
                  ? `Level ${level} is open to you`
                  : `Level ${level} needs a Level ${level - 1} receipt first`
              }
            >
              <b>L{level}</b>
              <span>{rule?.vp ?? '?'} VP</span>
              <span>£{rule?.coinsPerDelivery ?? '?'}</span>
              <FillOrderBonus data={data} seats={view.rivals.length + 1} tiles={tiles} />
              {!open.has(level) && <span className="island-locked">locked</span>}
            </span>
            <div className="island-tiles">
              {tiles.map((tile) => {
                const spent = tile.deliveredBy.length;
                const capacity = data.island.deliveriesPerTile;
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
                          <DemandToken demand={demand} size={Math.round(tileWidth * 0.34)} />
                          <b>{rule?.cardsPerCrate ?? '?'}</b>
                        </span>
                      ))}
                    </div>
                    {/* A receipt says WHO, so it carries the deliverer's crop
                        rather than the printed rosette: the token art is one
                        piece for every seat, and on the board the only question
                        anyone asks of a filled slot is whose it is. */}
                    <div className="island-receipts">
                      {Array.from({ length: capacity }, (_, i) => {
                        const seat = tile.deliveredBy[i];
                        const suit = seat === undefined ? undefined : suitOf(seat);
                        return (
                          <span
                            key={i}
                            className={`receipt${seat === undefined ? ' receipt-empty' : ''}`}
                            style={suit ? { background: SUIT_META[suit].pip } : undefined}
                            title={
                              seat === undefined
                                ? 'open delivery slot'
                                : `${suit ? SUIT_META[suit].label : `Seat ${seat}`} delivered here`
                            }
                          >
                            {suit && <img src={cropIcon(suit)} alt="" />}
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
    </div>
  );
}
