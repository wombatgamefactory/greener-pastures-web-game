/**
 * The rival inspector: the rail's compression, undone on demand.
 *
 * The rail deliberately carries only what a visit decision needs. Everything
 * else about a neighbour - their whole tableau at readable size, what is in
 * each stack, what they have banked - lives here, one click away.
 */

import type { GameData } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { cropIcon, frame, token } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import {
  farmOf,
  noticeBoardOf,
  receiptTotal,
  seatSuits,
  workerTrack,
  workersOwnedBy,
} from '../view/table';
import { Tableau, handSizeOf } from './Farm';
import { FillBar } from './StackGauge';
import { WorkerPanel } from './Worker';
import type { Zoomer } from './Zoom';

export function Inspector({
  data,
  view,
  seat,
  cardWidth,
  zoom,
  onClose,
}: {
  data: GameData;
  view: PlayerView;
  seat: Seat;
  cardWidth: number;
  zoom: Zoomer;
  onClose(): void;
}) {
  const farm = farmOf(view, seat);
  const board = noticeBoardOf(data, farm);
  const suits = seatSuits(view);
  const meta = SUIT_META[farm.suit];
  const workers = workersOwnedBy(view, seat);
  const handSize = handSizeOf(data, farm.tableau);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="inspector"
        style={{ ['--seat-ink' as string]: meta.ink }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${seatName(suits[seat], seat, view.seat)}'s farm`}
      >
        <header className="inspector-head">
          <img className="farm-crop" src={cropIcon(farm.suit)} alt="" />
          <h2>{seatName(suits[seat], seat, view.seat)}</h2>
          <span className="farm-coins">
            <img src={token('coin')} alt="" />£{farm.coins}
          </span>
          <span className="farm-vp">
            <img src={frame('vp')} alt="" />
            {receiptTotal(farm.receipts)} VP
          </span>
          <span>
            hand {farm.handCount}
            {handSize === null ? '' : ` / ${handSize}`}
          </span>
          <span>barn {farm.barnCount}</span>
          <button className="inspector-close" onClick={onClose} autoFocus>
            close
          </button>
        </header>

        <div className="inspector-visit">
          {board ? (
            <>
              <FillBar filled={board.filled} threshold={board.threshold} />
              <span>
                {board.full
                  ? 'Their board is full: nobody can visit until they harvest it.'
                  : `A card on their Notice Board pays you £${board.payout}${
                      board.twoCard === null ? '' : `, or two cards pay £${board.twoCard}`
                    }, or works one of their Hired Workers.`}
              </span>
            </>
          ) : (
            <span>This farm has no Notice Board, so it cannot be visited at all.</span>
          )}
        </div>

        {workers.length > 0 && (
          <div className="inspector-workers">
            {workers.map((w) => (
              <WorkerPanel
                key={w.id}
                track={workerTrack(data, w)}
                ownerLabel="theirs"
                hireFee={data.workers.hireFee}
              />
            ))}
          </div>
        )}

        <Tableau data={data} buildings={farm.tableau} cardWidth={cardWidth} zoom={zoom} />

        {farm.covered.length > 0 && (
          <p className="inspector-covered">
            {farm.covered.length} card{farm.covered.length === 1 ? '' : 's'} built over. They no
            longer exist as buildings, but their printed VP still scores.
          </p>
        )}
      </div>
    </div>
  );
}
