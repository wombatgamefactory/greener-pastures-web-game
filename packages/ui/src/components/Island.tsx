/**
 * The island: the shared scoring structure and the game's clock.
 *
 * Built as the printed cut-off pyramid - the old Level 3 row on top, Level 1
 * along the bottom - with the tiles butted edge to edge, because the art is
 * drawn to tile that way (the bookend faces paint the sea at each row's ends).
 * Everything except the map itself is DOM over text-free art, the same as a
 * card: the tiles carry no printed VP, coins or crate slots.
 *
 * THE ROWS ARE DECORATION. Every tile is deliverable at any time, so there is no
 * level label and no lock. ⭐ Since the token island (16/09/2026) a tile shows
 * the TOKENS still on it: each token's demand, its VP and its Worker, drawn
 * from the printed token art sliced 18/09/2026 (`islandTokenArt`, one piece per
 * crop/VP pair carrying all three facts at once - see `view/art.ts`). A taken
 * token has left the tile.
 *
 * ⭐ THE TOKEN PICKER (18/09/2026, 2.5.1, 2.5.2). A first delivery pays both of
 * a tile's tokens and CHOOSES which one it takes; `deliverStart` (`Play.tile`)
 * opens the deliver draft the moment a tile with a real choice is clicked, and
 * this file drives that draft's token straight off the tokens as drawn here
 * rather than making a player find the equivalent text chips in `DeliverPanel`
 * (`components/BuildPanel.tsx`, owned by another pass) below the map. Both
 * read and write the SAME `DeliverDraft` through `play.setDeliverDraft`, so
 * either surface finishes what the other started; `DeliverPanel` still owns the
 * barn-card payment step, which needs no tile-side equivalent. Dean's own
 * words are why this exists at all (`packages/data/data/island.json`
 * `meta.unresolved`): "the token set narrows the gap to 1 VP... so the token
 * choice is the reading to watch" - a choice worth measuring has to be a choice
 * a human can actually see, which a pair of unlabelled VP numbers was not.
 */

import { useEffect, useRef, useState } from 'react';
import type { GameData } from '@gp/data';
import { tokensPerTile } from '@gp/data';
import type { IslandToken, PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { deliverAdditions, withDeliverToken } from '../view/intent';
import { islandTileArt, islandTokenArt, islandTokenArtZoom } from '../view/art';
import { SUIT_META } from '../view/suits';
import { Meeple, workerActionLabel } from './Meeple';

export type Level = 1 | 2 | 3;

/** The tile's printed row. Layout only - no rule reads it. */
export function levelOf(data: GameData, tile: string): Level {
  const spec = data.island.tiles.find((t) => t.id === tile);
  if (!spec) throw new Error(`Unknown island tile ${tile}`);
  return spec.level;
}

/**
 * The one thing every tile shares, said once instead of on each of twelve
 * identical tiles. This is the whole island rule in a line, which is the point
 * of the flat island.
 */
function IslandLegend({ data }: { data: GameData }) {
  const { crates, cardsPerCrate } = data.island.tileRule;
  return (
    <p className="island-legend">
      Every island card: {crates} tokens. A delivery is {crates * cardsPerCrate} barn cards: both
      tokens&apos; demands first (you choose a token), then the last token&apos;s demand plus{' '}
      {cardsPerCrate} of any crop.
      {/*
       * B20, 25/09/2026: THE WILD TOKEN KEY. The appraisal named this
       * specifically ("the purple island token has no key"): a cornucopia
       * token's printed art reads as an odd-one-out on the tile and nothing on
       * screen said why until a player hovered it.
       *
       * ⚠️ A FULL SENTENCE HERE IS NOT FREE, AND NEITHER IS A SECOND LINE. Two
       * earlier cuts both cost real height this legend's row does not have: a
       * second `<p>` cost 37px at 1366x768 (measured on `verify:layout`,
       * which shrank `.farm`'s row enough to clip the hand), and even a
       * clause of extra WORDS on this same line wrapped it to two lines on
       * `measure-ui`'s densest fixture at 1600x900 (4px sliced off the
       * tableau). What is left is the swatch alone, sized to the line it sits
       * on - the explanation is one hover or one Tab stop away on its `title`
       * and `aria-label`, which costs nothing until it is asked for.
       */}{' '}
      <span
        className="island-key-inline"
        // WP5 item 1, 25/09/2026: `role="img"` fixes axe's `aria-prohibited-attr`
        // - a plain `<span>` has no implicit role that supports naming at all
        // ("generic"), so `aria-label` on it alone is invalid ARIA even though
        // every browser tested still exposed it. This element IS a small
        // graphical key (the swatch below), so `img` is the correct role, not
        // a workaround.
        role="img"
        tabIndex={0}
        title="A cornucopia token (the odd one out on a tile) pays with ANY 2 cards, your choice of crop."
        aria-label="Key: the round purple token is a cornucopia. It pays with any 2 cards, your choice of crop."
      >
        <span className="island-key-swatch" aria-hidden="true" />
      </span>
    </p>
  );
}

/**
 * B20, 25/09/2026: what a delivery to THIS tile needs and pays, in one
 * sentence, for the hover/focus tooltip below. Reads the same two facts the
 * legend states in general terms (`IslandLegend` above) but keyed to this
 * tile's OWN printed tokens, which is the reading a player actually plans a
 * delivery from - "2 Apple + 2 Wheat" rather than "both tokens' demands".
 */
function tileNeedText(data: GameData, tokens: readonly IslandToken[]): string {
  const { cardsPerCrate } = data.island.tileRule;
  const demand = (t: IslandToken) =>
    `${cardsPerCrate} ${t.demand === 'wild' ? 'of any crop' : SUIT_META[t.demand].label}`;
  const [a, b] = tokens;
  if (a && b) {
    return `First delivery here needs ${demand(a)} plus ${demand(b)}, and chooses which token it takes; the other waits for a later delivery.`;
  }
  if (a) {
    return `Second delivery here needs ${demand(a)} plus ${cardsPerCrate} of any crop, and takes the last token.`;
  }
  return 'Both tokens claimed. This tile is closed.';
}

export function IslandPanel({
  data,
  view,
  tileWidth: minTileWidth,
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
  const capacity = tokensPerTile(data);
  /*
   * B15, 25/09/2026: FILL THE COLUMN, DON'T JUST SIT IN IT.
   *
   * `tileWidth` (renamed `minTileWidth` here) is the CSS ladder's value
   * (`--island-tile-w`, `base.css`) - tuned as a FLOOR against the tableau's
   * own capacity budget at 1024-1600, never as a ceiling. At 2560 and 3440 the
   * shared table's middle column has thirty-odd percent more width than five
   * fixed-width tiles need (measured: the island painted at about 36% of its
   * column, appraisal's "dead band"), and nothing before this used the rest.
   *
   * `fitWidth` is the width that would make the WIDEST row exactly fill the
   * container this panel is actually given, measured with a `ResizeObserver`
   * rather than the window (the shared table's column is narrower than the
   * window by the rail and the reading region, both of which this component
   * has no way to know about otherwise). The rendered width is
   * `Math.max(minTileWidth, fitWidth)`, so a step where the ladder's own value
   * is already the tighter fit (1024-1600) is completely unaffected - this
   * only ever grows the island, never shrinks it below what capacity planning
   * settled on.
   */
  const rowCounts = rows.map(
    (level) => view.island.tiles.filter((t) => levelOf(data, t.tile) === level).length,
  );
  const widestRow = Math.max(1, ...rowCounts);
  const deepRows = Math.max(1, rowCounts.filter((n) => n > 0).length);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ROW_GAP = 6; // `.island-row`'s own gap (island.css)
    /*
     * ⚠️ GATED TO 2400px AND UP, ON PURPOSE. The fill logic ran at every step
     * on the first cut, and at 1600x900 it grew the island just enough to
     * push `measure-ui`'s own densest fixture back into slicing 5 of 5
     * buildings (0px hidden before, 31px after) - a viewport this file was
     * never supposed to touch, since 1024-1600 already have `--island-tile-w`
     * tuned against that exact capacity budget (`base.css`). B15 only ever
     * asked for the 2400+ steps; below that this resolves to `minTileWidth`,
     * i.e. exactly what shipped before this component changed.
     *
     * ⚠️ BY HEIGHT AS WELL AS WIDTH, IN ONE PASS, NOT A MEASURE-AND-CORRECT
     * LOOP. A first cut fit the widest row to the column's width alone and
     * left a SECOND effect to measure the result and shrink it if too tall -
     * which needs an extra render to settle, and `verify:layout`'s mid-action
     * pass caught it landing mid-settle often enough to read as flaky (the
     * qhd hand strip clipped on some runs and not others, same seed, same
     * build). `HEIGHT_PER_TILE_WIDTH` folds the island's real per-row cost
     * (not just the tile art - the token and Worker chrome under it) into one
     * constant, calibrated off the pre-B15 island (578px tall at 126px tile
     * width, 3 rows: 578 / 126 = 4.587), so both bounds are known before the
     * first render rather than discovered after it.
     */
    // Calibrated at deepRows = 3 (578px tall at a 126px tile, the pre-B15
    // island): 578 / 126 / 3 rows = 1.529 per row per pixel of tile width.
    const HEIGHT_PER_ROW_PER_TILE_WIDTH = 1.529;
    const measure = () => {
      if (window.innerWidth < 2400) {
        setFitWidth(0);
        return;
      }
      const w = el.getBoundingClientRect().width;
      const byWidth = (w - ROW_GAP * (widestRow - 1)) / widestRow;
      const budgetHeight = window.innerHeight * 0.42;
      const byHeight = budgetHeight / deepRows / HEIGHT_PER_ROW_PER_TILE_WIDTH;
      setFitWidth(Math.max(0, Math.floor(Math.min(byWidth, byHeight))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [widestRow, deepRows]);
  // Capped a little above the enlarge overlay's own ceiling (200px): the
  // inline map sits beside a farm and a rail and should never outgrow either.
  const tileWidth = Math.min(300, Math.max(minTileWidth, fitWidth));
  // The play tier (238x256) is already sharper than an inline tile ever draws
  // it; the zoom tier only earns its weight once a token is drawn bigger than
  // that, which is exactly the enlarged overlay (`IslandOverlay` below, up to
  // 200px of tile width) and nowhere the inline map goes.
  const tokenArt = tileWidth >= 140 ? islandTokenArtZoom : islandTokenArt;

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
      ref={containerRef}
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
                // ⭐ THE TOKEN PICKER'S STATE (2.5.1). `intent.k === 'deliver'`
                // is the SAME draft `DeliverPanel` reads - `deliverAdditions`
                // tells us which token indices are still choosable, which is
                // more than one exactly when this tile's first delivery has not
                // yet named a token. Any other tile (or no draft at all) gets
                // an empty set here, so its tokens render as information only.
                const draft =
                  play?.intent.k === 'deliver' && play.intent.draft.tile === tile.tile
                    ? play.intent.draft
                    : null;
                const additions = draft && play ? deliverAdditions(play.moves, draft) : null;
                const tokenChoiceOpen = (additions?.tokens.length ?? 0) > 1;
                const tokenSize = Math.round(tileWidth * 0.42);
                const workerSize = Math.max(12, Math.round(tileWidth * 0.22));
                // B20, 25/09/2026: what THIS tile needs and pays, for the
                // hover/focus tooltip below - see `tileNeedText`'s own banner.
                const needText = tileNeedText(data, tile.tokens);
                return (
                  <div
                    key={tile.tile}
                    data-card={tile.tile}
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
                    /*
                     * ⭐ 25/09/2026 (B20): ALWAYS FOCUSABLE, NOT ONLY WHEN
                     * LIVE. A tile you cannot deliver to right now is still a
                     * tile a player wants to read - "what does this one want"
                     * is a planning question, not just a this-turn question -
                     * so `role`/`tabIndex` no longer gate on `live` the way
                     * item 4's rival boards and B23's decks do not either.
                     * Activation (the click/Enter/Space branch) still does.
                     */
                    role="button"
                    aria-disabled={!live}
                    aria-label={needText}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!live || (e.key !== 'Enter' && e.key !== ' ')) return;
                      e.stopPropagation();
                      deliver(tile.tile);
                    }}
                  >
                    <img className="island-art" src={islandTileArt(tile.tile)} alt="" />
                    {/* The tooltip itself: CSS-only reveal on hover or focus
                        (`island.css`), same idiom as the deck popover (B23) -
                        no JS state, works the same for a pointer and for a
                        keyboard user tabbing onto the tile. */}
                    <div className="island-tip" aria-hidden="true">
                      {needText}
                    </div>
                    {/*
                     * THE TOKENS STILL ON THE TILE (2.5.1). One printed face per
                     * token - crop pair (or the cornucopia pair for a wild
                     * token), its VP and, on the 4 and 3 VP tokens, the printed
                     * Worker silhouette are all one image now (`view/art.ts`).
                     * A live coloured Worker pawn sits over that silhouette so
                     * its actual colour (randomised at setup) is legible, which
                     * the generic printed silhouette cannot carry on its own.
                     *
                     * When a FIRST delivery on THIS tile is being assembled and
                     * both tokens are still open, each token becomes its own
                     * clickable target - `play.setDeliverDraft` writes straight
                     * into the same draft `DeliverPanel` finishes, so either
                     * surface can complete the choice. This is deliberately the
                     * loudest thing on the tile: Dean's own reading question is
                     * whether a human ever gives up VP for a Worker, and a
                     * choice nobody can see is a choice nobody can measure.
                     */}
                    {/*
                     * ⚠️ POSITIONED INLINE, NOT IN `styles/island.css` (owned by
                     * another pass): this replaces the three absolutely-
                     * positioned rows (`.island-demands`/`.island-receipts`/
                     * `.island-meeples`) that used to overlay `.island-art`
                     * (itself `position: absolute; inset: 0` inside a
                     * `position: relative` tile). `.island-tokens`
                     * (`styles/island.css`, split from `table.css` 25/09/2026)
                     * carries the layout now.
                     */}
                    <div className="island-tokens">
                      {tile.tokens.map((token, i) => {
                        const selectable =
                          tokenChoiceOpen && (additions?.tokens.includes(i) ?? false);
                        const selected = draft !== null && draft.token === i;
                        const cropLabel =
                          token.demand === 'wild'
                            ? 'Any crop (cornucopia)'
                            : SUIT_META[token.demand].label;
                        const workerLabel =
                          token.worker !== null
                            ? `, with a ${SUIT_META[token.worker].label} Worker (${workerActionLabel(data)[token.worker]})`
                            : '';
                        const label = `${cropLabel} pair, ${token.vp} VP${workerLabel}${
                          selectable
                            ? selected
                              ? ' - chosen'
                              : ' - click to take this one instead'
                            : ''
                        }`;
                        const select = (e: { stopPropagation(): void }) => {
                          if (!selectable || !draft || !play || !play.setDeliverDraft) return;
                          e.stopPropagation();
                          play.setDeliverDraft(withDeliverToken(draft, i));
                        };
                        return (
                          <span
                            key={i}
                            className={`island-token${selectable ? ' island-token-choice' : ''}${
                              selected ? ' island-token-selected' : ''
                            }`}
                            style={{
                              position: 'relative',
                              display: 'inline-block',
                              ...(selectable || selected
                                ? {
                                    outline: `3px ${selected ? 'solid #2f7d3a' : 'dashed #b98a2f'}`,
                                    outlineOffset: 2,
                                    borderRadius: 8,
                                    cursor: selectable ? 'pointer' : undefined,
                                  }
                                : {}),
                            }}
                            role={selectable ? 'button' : undefined}
                            tabIndex={selectable ? 0 : undefined}
                            title={label}
                            onClick={selectable ? select : undefined}
                            onKeyDown={
                              selectable
                                ? (e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    select(e);
                                  }
                                : undefined
                            }
                          >
                            <img
                              className="island-token-art"
                              src={tokenArt(token.demand, token.vp)}
                              alt=""
                              style={{ width: `${tokenSize}px`, height: 'auto', display: 'block' }}
                            />
                            {token.worker !== null && (
                              <span
                                className="island-token-worker"
                                style={{ position: 'absolute', right: 2, bottom: 2 }}
                              >
                                <Meeple
                                  data={data}
                                  colour={token.worker}
                                  size={workerSize}
                                  title={`${SUIT_META[token.worker].label} Worker (${workerActionLabel(data)[token.worker]})`}
                                />
                              </span>
                            )}
                            <span className="visually-hidden">{label}</span>
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
  /*
   * B26, 25/09/2026: A TRUE DIALOG. `role="dialog"` was already here; what was
   * missing is what makes that role trustworthy - `aria-modal`, so a screen
   * reader hides the rest of the page while this is open, a focus TRAP, so Tab
   * cannot walk out of the overlay into the table behind it, and focus
   * RETURN, so closing it puts the keyboard back where it was rather than at
   * the top of the document (both named in the appraisal's accessibility
   * finding and B26's brief).
   */
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      opener?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
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
        ref={dialogRef}
        className="island-large"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
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
