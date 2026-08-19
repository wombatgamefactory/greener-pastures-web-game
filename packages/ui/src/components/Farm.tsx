/**
 * Your farm, and the tableau renderer the rival inspector reuses.
 *
 * The tableau is the one place a card is shown WITH its stack, so the gauge is
 * drawn over the card rather than beside it: a building and how full it is are
 * one object on the table, and separating them was the thing variant C got
 * wrong. Hand and barn sit under it because they are the two halves of the
 * clock - hand is what you can spend this turn, barn is what the island wants.
 */

import type { GameData, Suit } from '@gp/data';
import type { BuildingView, PlayerView } from '@gp/engine';

import type { Drag } from '../session/drag';
import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon, frame, token } from '../view/art';
import { dropZone } from '../view/drop';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { displayOrder, receiptTotal } from '../view/table';
import { Card, CardBack } from './Card';
import { StackGauge } from './StackGauge';
import type { Zoomer } from './Zoom';

/**
 * A row of buildings. Shared by your farm and the rival inspector, which is why
 * `play` is optional: a neighbour's tableau is read-only, and passing no play
 * object is how that is enforced rather than remembered.
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
        const full = face.threshold !== null && b.stack.length >= face.threshold;
        const live = play?.live.buildings.has(b.card) ?? false;
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
              <StackGauge stack={b.stack} threshold={face.threshold} />
            </div>
            {full && <span className="building-clog">full</span>}
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
 * The hand is the one region that does NOT feed the zoom panel: its cards print
 * their own text and grow to reading size under the pointer (`card-readable` in
 * card.css, `.hand-card:hover` in table.css). Sending them to the panel as well
 * put the same card on screen twice, side by side and overlapping, and at the
 * 700px floor the panel won and covered the card you were reading.
 */
function Hand({
  data,
  hand,
  cardWidth,
  handSize,
  play,
  drag,
}: {
  data: GameData;
  hand: readonly string[];
  cardWidth: number;
  handSize: number | null;
  play?: Play | undefined;
  drag?: Drag | undefined;
}) {
  const over = handSize !== null && hand.length > handSize;
  const held = play?.intent.k === 'hold' ? play.intent.card : null;
  const committed = new Set<string>(play?.commitments ?? []);
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
      <div className="hand">
        {hand.length === 0 && <p className="empty-note">No cards. Every visit costs one.</p>}
        {hand.map((id, i) => {
          const live = play?.live.hand.has(id) ?? false;
          const state = held === id ? ' is-held' : committed.has(id) ? ' is-picked' : '';
          return (
            <div
              key={`${id}-${i}`}
              className={`hand-card${state}${mark(play, live)}`}
              style={{ zIndex: i }}
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
              {/* `card-readable` keeps the ability band alive at play size:
                  the hand is the one place the text IS the decision, so it is
                  not allowed to fall back to the zoom panel (card.css). */}
              <Card face={printedFace(data, id)} width={cardWidth} className="card-readable" />
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

export function Farm({
  data,
  view,
  buildingWidth,
  handWidth,
  zoom,
  play,
  drag,
}: {
  data: GameData;
  view: PlayerView;
  buildingWidth: number;
  handWidth: number;
  zoom: Zoomer;
  play?: Play | undefined;
  drag?: Drag | undefined;
}) {
  const meta = SUIT_META[view.you.suit];
  const yourTurn = view.turnPlayer === view.seat;

  return (
    <section
      className={`farm${yourTurn ? ' farm-active' : ''}`}
      style={{ ['--seat-ink' as string]: meta.ink, ['--seat-pip' as string]: meta.pip }}
      aria-label="your farm"
    >
      <header className="farm-head">
        <img className="farm-crop" src={cropIcon(view.you.suit)} alt="" />
        <h2>Your {meta.label} farm</h2>
        <span className="farm-coins" title="coins are spend-only: they are not victory points">
          <img src={token('coin')} alt="" />£{view.you.coins}
        </span>
        <span className="farm-vp" title="VP on the island receipts you hold">
          <img src={frame('vp')} alt="" />
          {receiptTotal(view.you.receipts)} VP
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
          play={play}
          drag={drag}
        />
        <Barn barn={view.you.barn} cardWidth={Math.round(handWidth * 0.66)} />
      </div>
    </section>
  );
}
