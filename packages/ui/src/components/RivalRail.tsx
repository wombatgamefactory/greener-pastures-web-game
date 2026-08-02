/**
 * The left rail: your neighbours, compressed to what a VISIT decision needs.
 *
 * Dean chose this layout in ticket 09 for one reason, and it is the reason the
 * rail must not drift into a general-purpose summary: it is a permanent "who
 * should I visit" scoreboard. Everything on a rail card answers that question -
 * can I get on their Notice Board (fill bar), what would I get (payout, their
 * Workers and where the meeples stand), and are they winning (coins, receipts).
 * Anything else belongs in the inspector behind a click.
 *
 * A seat with NO Notice Board renders as "closed to visitors" rather than
 * throwing. That is a reachable position - D11 and D14 can cover or demolish a
 * starter (ticket 30) - and the interface has to survive it.
 */

import type { GameData } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { cropIcon } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import {
  farmOf,
  noticeBoardOf,
  receiptTotal,
  seatSuits,
  workerTrack,
  workersOwnedBy,
} from '../view/table';
import { FillBar } from './StackGauge';
import { WorkerPanel } from './Worker';

export function RivalRail({
  data,
  view,
  onInspect,
}: {
  data: GameData;
  view: PlayerView;
  onInspect(seat: Seat): void;
}) {
  const suits = seatSuits(view);

  return (
    <div className="rail" aria-label="your neighbours">
      {view.rivals.map((rival) => {
        const farm = farmOf(view, rival.seat);
        const board = noticeBoardOf(data, farm);
        const workers = workersOwnedBy(view, rival.seat);
        const meta = SUIT_META[farm.suit];
        const theirTurn = view.turnPlayer === rival.seat;

        return (
          <article
            key={rival.seat}
            className={`rival${theirTurn ? ' rival-active' : ''}`}
            style={{ ['--seat-ink' as string]: meta.ink, ['--seat-pip' as string]: meta.pip }}
          >
            {/* The whole header is the way in to the inspector. A separate
                "look at their farm" button cost 24px per neighbour, which at
                three neighbours is the difference between all of them fitting
                above the fold at 1024x700 and one of them not. */}
            <button className="rival-head" onClick={() => onInspect(rival.seat)}>
              <img className="rival-crop" src={cropIcon(farm.suit)} alt="" />
              <h3>{seatName(suits[rival.seat], rival.seat, view.seat)}</h3>
              {theirTurn && <span className="rival-turn">to play</span>}
              <span className="rival-open" aria-hidden="true">
                look
              </span>
            </button>

            <dl className="rival-stats">
              <div>
                <dt>coins</dt>
                <dd>£{farm.coins}</dd>
              </div>
              <div>
                <dt>VP banked</dt>
                <dd>{receiptTotal(farm.receipts)}</dd>
              </div>
              <div>
                <dt>hand</dt>
                <dd>{farm.handCount}</dd>
              </div>
              <div>
                <dt>barn</dt>
                <dd>{farm.barnCount}</dd>
              </div>
            </dl>

            {board ? (
              <div className="rival-board">
                <FillBar filled={board.filled} threshold={board.threshold} />
                <span className="rival-payout">
                  {board.full ? 'no room - visit blocked' : `visit pays £${board.payout}`}
                  {board.twoCard !== null && !board.full && ` · 2 cards £${board.twoCard}`}
                </span>
              </div>
            ) : (
              <p className="rival-board rival-board-none">
                No Notice Board. This farm cannot be visited.
              </p>
            )}

            {workers.length > 0 && (
              <div className="rival-workers">
                {workers.map((w) => (
                  <WorkerPanel
                    key={w.id}
                    track={workerTrack(data, w)}
                    ownerLabel="theirs"
                    hireFee={data.workers.hireFee}
                    size="rail"
                  />
                ))}
              </div>
            )}

            <div className="rival-dots" aria-label="their buildings">
              {farm.tableau.map((b) => {
                const card = data.cards.catalogue.find((c) => c.id === b.card);
                const suit = card?.suit ?? farm.suit;
                const full =
                  b.stack.length > 0 &&
                  b.stack.length >= (card?.threshold ?? card?.faces?.starter.threshold ?? Infinity);
                return (
                  <span
                    key={b.card}
                    className={`dot${full ? ' dot-full' : ''}${b.upgraded ? ' dot-upgraded' : ''}`}
                    style={{ background: SUIT_META[suit].pip }}
                    title={`${card?.name ?? b.card}${full ? ' (full)' : ''}`}
                  />
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
