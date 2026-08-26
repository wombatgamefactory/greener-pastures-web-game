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

import { useEffect, useState } from 'react';
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
  onExpand,
  onDeliver,
}: {
  data: GameData;
  view: PlayerView;
  tileWidth: number;
  play?: Play | undefined;
  /**
   * Click the map to see it at full size. Absent inside the overlay itself -
   * that is what stops the enlarged island offering to enlarge again.
   */
  onExpand?: (() => void) | undefined;
  /** Called after a delivery is chosen, so the overlay can get out of the way. */
  onDeliver?: (() => void) | undefined;
}) {
  const rows: Level[] = [3, 2, 1];
  const capacity = deliveriesPerTile(data);
  const { cardsPerCrate } = data.island.tileRule;
  const suitOf = (seat: Seat): Suit | undefined =>
    seat === view.seat ? view.you.suit : view.rivals.find((r) => r.seat === seat)?.suit;

  /*
   * ⚠️ A LIVE TILE'S CLICK MUST NOT ALSO EXPAND THE MAP, and `stopPropagation`
   * is why this is safe rather than a race between two handlers. The tile's own
   * handler is the Deliver action and it is the more specific of the two, so it
   * swallows the event; the map's handler therefore only ever sees clicks on
   * sea, on a finished tile, or on a tile that is not a legal target this turn -
   * exactly the clicks that meant nothing before.
   *
   * The gesture is deliberately NOT the only route in. `.island-expand` in the
   * panel title is a real button, which is what makes this keyboard reachable
   * and what puts the affordance on screen; the map click is the one a mouse
   * reaches for first. Nesting the map inside a button instead would have put
   * twelve `role="button"` tiles inside another button, which is invalid and
   * would have made every tile un-announceable.
   */
  const deliver = (tile: string) => {
    play?.tile(tile);
    onDeliver?.();
  };

  return (
    <div
      className={`island${onExpand ? ' island-openable' : ''}`}
      style={{ ['--island-tile' as string]: `${tileWidth}px` }}
      onClick={onExpand}
      title={onExpand ? 'Click the map to see the island at full size' : undefined}
    >
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
                    onClick={
                      live
                        ? (e) => {
                            e.stopPropagation();
                            deliver(tile.tile);
                          }
                        : undefined
                    }
                    role={live ? 'button' : undefined}
                    tabIndex={live ? 0 : undefined}
                    onKeyDown={
                      live
                        ? (e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.stopPropagation();
                            deliver(tile.tile);
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

/**
 * ⭐ THE ISLAND, ENLARGED (phase 5).
 *
 * The island is the game's clock (delivering to the top level fires the end
 * trigger) and its largest single VP source, deliberately over half a winning
 * score. Phase 2 grew the inline map by 45% in area and it is still a map read
 * at a glance: the demand tokens run about 22px and the receipt numerals about
 * 11px, which is enough to see THAT a tile wants two crates and not enough to
 * plan a delivery round from. So the map keeps its glance size in the commons
 * and gains a full-size reading of itself on demand.
 *
 * ⚠️ IT IS THE SAME COMPONENT, NOT A SECOND RENDERER. Everything here is
 * `IslandPanel` at a bigger `tileWidth`, because the tile art, the crate
 * quantities and the receipt discs already scale off `--island-tile` (phase 2
 * made them do so, under a `max()` floor). A separate large-island renderer
 * would be a second place for the island's rules to be drawn, and the two would
 * drift the first time a rule changed.
 *
 * IT MUST NOT BLOCK A DECISION. The overlay is not modal in the game's sense:
 * `play` goes through it, so every tile that is a legal delivery is live IN the
 * overlay and taking one closes it (`onDeliver`). If it happens to be open when
 * your turn arrives, the move you would have made is on the screen in front of
 * you at four times the size. Three ways out - Escape, the scrim, the close
 * button, which takes focus on open.
 *
 * The scrim and the panel are `Inspector`'s idiom exactly, down to the class
 * names (`.overlay`, `.inspector-close`), rather than a second modal shape.
 */
export function IslandOverlay({
  data,
  view,
  play,
  onClose,
}: {
  data: GameData;
  view: PlayerView;
  play?: Play | undefined;
  onClose(): void;
}) {
  /*
   * The tile size is computed rather than dialled, because what "full size"
   * means here is a question about the pyramid's shape and the window, and both
   * change: the widest row grows with the player count and the window is the
   * window. Held in state with a resize listener, the same way `Table.tsx`
   * reads its CSS sizes back.
   *
   * `--island-tile-w` is untouched by this. The inline map's step is a layout
   * decision that the tableau and the decks are balanced against, and the
   * enlarged one has no such neighbours to answer to.
   */
  const [tile, setTile] = useState(120);
  const levels: Level[] = [3, 2, 1];
  const counts = levels.map(
    (level) => view.island.tiles.filter((t) => levelOf(data, t.tile) === level).length,
  );
  const widest = Math.max(1, ...counts);
  const deep = Math.max(1, counts.filter((n) => n > 0).length);

  useEffect(() => {
    const fit = () => {
      // 375 / 520 is the tile art's aspect, so a row of `widest` tiles is
      // `widest * w` across and a stack of `deep` rows is `deep * w / 0.721`
      // tall. The subtractions are the scrim padding, the panel's own padding
      // and the header and legend above and below the map.
      const across = (window.innerWidth * 0.94 - 72) / widest;
      const down = ((window.innerHeight * 0.9 - 132) / deep) * (375 / 520);
      setTile(Math.max(64, Math.min(200, Math.floor(Math.min(across, down)))));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [widest, deep]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="island-large"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="the island, enlarged"
      >
        <header className="island-large-head">
          <h2>The island</h2>
          <p>
            The game&rsquo;s clock and its biggest score. A delivery you can make now is lit; taking
            one closes this.
          </p>
          <button type="button" className="inspector-close" onClick={onClose} autoFocus>
            close
          </button>
        </header>
        <IslandPanel data={data} view={view} tileWidth={tile} play={play} onDeliver={onClose} />
      </div>
    </div>
  );
}
