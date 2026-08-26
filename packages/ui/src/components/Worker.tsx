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
        {/*
         * ⭐ THE RAIL CHIP IS TWO FACTS, AND THE NAME IS NOT ONE OF THEM
         * (phase 4). "The Market Stall" is flavour; what a visit decision turns
         * on is the ACTION on offer and what taking it costs. Until now the rail
         * hid BOTH of those in CSS and showed only the name, which is the exact
         * inverse of this component's own brief - see the header comment: "all
         * this chip has to make instant is the ACTION on offer". The name
         * survives as the chip's `title`, and the card itself is one click away
         * in the inspector the panel header opens.
         *
         * ⚠️ THE ACTION IS THE LABEL, NOT THE PRINTED SENTENCE. `actionText`
         * runs to a full line of rules text ("Build at a discount of 2. Cards of
         * any crop may satisfy its crop requirements.") and printing it here
         * wrapped a neighbour's chip to three lines and shouldered the commons
         * panel off its own column. What a visitor scans three neighbours for is
         * only ever WHICH of the five actions this is, so the chip prints the
         * word and hands the sentence to the tooltip and the inspector.
         *
         * The price is whichever price is YOURS to care about, and the two are
         * different in kind. A rival's Service is bought with a CARD - which is
         * the whole of "your junk is their treasure", and is why the chip says
         * so rather than saying "pays nothing", the literally true but wholly
         * misleading reading of a `visitWage` that is ruled at 0. Your own is
         * bought with a coin and places no card at all, so an owner never clogs
         * their own Service. If the wage is ever restored (there is a paired
         * overlay for exactly that question) the chip picks it up on its own.
         */}
        {size === 'rail' ? (
          <span className="worker-name" title={`${track.name} - ${track.actionText}`}>
            <span className="worker-verb">{track.actionLabel}</span>
            <em>
              {mine
                ? `£${track.ownCost}`
                : track.wage > 0
                  ? `1 card, pays £${track.wage}`
                  : '1 card'}
            </em>
          </span>
        ) : (
          <>
            <span className="worker-name">
              {track.name}
              <em>{ownerLabel}</em>
            </span>
            <span className="worker-action">{track.actionText}</span>
            <span className="worker-next">
              {mine
                ? `£${track.ownCost} to use your own, and no card placed`
                : track.wage > 0
                  ? `1 card here, and the bank pays them £${track.wage}`
                  : `1 card here - and the card is all they get for it`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
