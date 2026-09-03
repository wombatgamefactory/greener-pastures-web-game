/**
 * The rival inspector: the rail's compression, undone on demand.
 *
 * The rail deliberately carries only what a visit decision needs. Everything
 * else about a neighbour - their whole tableau at readable size, what is in
 * each stack, what they have banked - lives here, one click away.
 */

import type { GameData } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { cropIcon, frame } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import { doorOf, farmOf, noticeBoardOf, receiptTotal, seatSuits } from '../view/table';
import { DoorChip } from './Door';
import { Tableau } from './Farm';
import { FillBar } from './StackGauge';
import { MeepleSupply } from './Supply';
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
  const door = doorOf(data, farm.suit);

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
          <span className="farm-vp">
            <img src={frame('vp')} alt="" />
            {receiptTotal(farm.receipts)} VP
          </span>
          {/* ⭐ Against the limit, since it came back on 02/09/2026 - and here
              it is worth showing for a RIVAL as well as for you: the limit is
              one global rule, so a neighbour's hand count reads as a fraction of
              the same ceiling and you can see who is about to have to throw
              cards away. */}
          <span>
            hand {farm.handCount}
            {data.rules.turn.handLimit === null ? '' : ` / ${data.rules.turn.handLimit}`}
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
                  : `One card on their Notice Board, and you take their door: ${board.actionText}`}
              </span>
            </>
          ) : (
            <span>This farm has no Notice Board, so it cannot be visited at all.</span>
          )}
        </div>

        {/* Their meeples, at full size: what free actions they are holding, and
            of which colours. On a rival's panel this is read-only - a meeple is
            spent by its owner, at the start of their own turn. */}
        <MeepleSupply data={data} meeples={farm.meeples} label="Their meeples" />

        <div className="inspector-workers">
          <DoorChip door={door} owner="theirs" showMeeple />
        </div>

        <Tableau data={data} buildings={farm.tableau} cardWidth={cardWidth} zoom={zoom} />
      </div>
    </div>
  );
}
