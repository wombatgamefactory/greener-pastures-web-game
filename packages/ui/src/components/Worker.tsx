/**
 * A suit SERVICE: what it does, what it pays and what it costs to run.
 *
 * There is no Working Week to draw any more (2026-08-10). The tension the track
 * used to carry - consume it or collect - moved onto the Service's own
 * threshold, and that is drawn by the Tableau like any other building, because
 * the Service IS an ordinary building. All this chip has to make instant is the
 * ACTION on offer, since the whole cross-table read of the game is now "what can
 * each neighbour do for me".
 */

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { workerArt } from '../view/art';
import { SUIT_META } from '../view/suits';
import type { WorkerTrack } from '../view/table';

export function WorkerPanel({
  track,
  ownerLabel,
  size = 'full',
  play,
}: {
  track: WorkerTrack;
  /** 'yours' or 'theirs'. Never null: every Service has an owner from setup. */
  ownerLabel: string;
  size?: 'full' | 'rail';
  play?: Play | undefined;
}) {
  const meta = SUIT_META[track.linkedSuit];
  const live = play?.live.workers.has(track.worker.id) ?? false;
  const mine = ownerLabel === 'yours';
  return (
    <div
      className={`worker worker-${size}${mark(play, live)}`}
      style={{ borderColor: meta.pip }}
      onClick={live ? () => play?.worker(track.worker.id) : undefined}
      role={live ? 'button' : undefined}
      tabIndex={live ? 0 : undefined}
      onKeyDown={
        live
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') play?.worker(track.worker.id);
            }
          : undefined
      }
    >
      {size === 'full' && <img className="worker-art" src={workerArt(track.worker.id)} alt="" />}
      <div className="worker-body">
        <span className="worker-name">
          {track.name}
          <em>{ownerLabel}</em>
        </span>
        {size === 'full' && <span className="worker-action">{track.actionText}</span>}
        <span className="worker-next">
          {mine
            ? `£${track.ownCost} to use your own, and no card placed`
            : track.wage > 0
              ? `1 card here, and the bank pays them £${track.wage}`
              : `1 card here - and the card is all they get for it`}
        </span>
      </div>
    </div>
  );
}
