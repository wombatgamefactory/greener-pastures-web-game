/**
 * A Hired Worker: the card, its Working Week track, and the meeple standing on
 * it. Rendered in the Hiring Fair (unowned) and on a farm panel (owned).
 *
 * The track is the whole tension the design hangs on the Workers - consume it
 * for free tempo, or leave it and collect - so the meeple's position and the
 * wage it lands on next are the two things this must make instant. The wage
 * shown is what the OWNER takes from the bank when a RIVAL works it; the
 * owner's own uses pay nothing and still advance the meeple.
 */

import { workerArt } from '../view/art';
import { SUIT_META } from '../view/suits';
import type { WorkerTrack } from '../view/table';

export function WorkerPanel({
  track,
  ownerLabel,
  hireFee,
  size = 'full',
}: {
  track: WorkerTrack;
  /** Null when the Worker is still in the Fair. */
  ownerLabel: string | null;
  hireFee: number;
  size?: 'full' | 'rail';
}) {
  const meta = SUIT_META[track.linkedSuit];
  return (
    <div className={`worker worker-${size}`} style={{ borderColor: meta.pip }}>
      {size === 'full' && <img className="worker-art" src={workerArt(track.worker.id)} alt="" />}
      <div className="worker-body">
        <span className="worker-name">
          {track.name}
          {ownerLabel === null ? (
            <em className="worker-hire">for hire £{hireFee}</em>
          ) : (
            <em>{ownerLabel}</em>
          )}
        </span>
        {size === 'full' && <span className="worker-action">{track.actionText}</span>}
        <ol className="worker-track" aria-label="Working Week">
          {track.spaces.map((space, i) => (
            <li
              key={i}
              className={`worker-space${space.here ? ' worker-space-here' : ''}`}
              aria-current={space.here ? 'step' : undefined}
            >
              {space.here ? (
                <span className="worker-meeple" aria-label="the Worker is here" />
              ) : space.wage === null ? (
                <span className="worker-sun">☀</span>
              ) : (
                `£${space.wage}`
              )}
            </li>
          ))}
          <li
            className="worker-space worker-space-home"
            title="past the last wage, the Worker walks home"
          >
            ⌂
          </li>
        </ol>
        {ownerLabel !== null && (
          <span className="worker-next">
            {track.lastUse
              ? 'next use sends them home'
              : `next rival use pays £${track.nextWage} to the owner`}
          </span>
        )}
      </div>
    </div>
  );
}
