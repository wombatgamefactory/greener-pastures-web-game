/**
 * A SUIT'S DOOR: which of the five actions that colour grants.
 *
 * ⭐ IT REPLACED `Worker.tsx` (v31), and the deletion is the point. That
 * component drew a Service - a card with an owner, a wage the bank paid that
 * owner and a price its owner paid to run it - and none of the three exists any
 * more. A colour means exactly one thing now, and it means it in two places at
 * once: it is what a card placed on that farm's Notice Board buys, and it is
 * what a MEEPLE of that colour does when spent. So this chip carries one fact,
 * the action, and the colour it belongs to.
 *
 * That is also why it is used in three places that used to need three shapes:
 * the commons' doors legend (which is the meeple key), a rival's rail card, and
 * the inspector.
 */

import { doorArt } from '../view/art';
import { SUIT_META } from '../view/suits';
import type { Door } from '../view/table';
import { Meeple } from './Meeple';

export function DoorChip({
  door,
  owner,
  size = 'full',
  showMeeple = false,
}: {
  door: Door;
  /**
   * How this door is owned, in the words the surface wants: 'yours', 'theirs',
   * or a farm's name in the legend. Null when no seat farms this colour - a
   * real state at 2 and 3 seats, and one the legend must show rather than hide,
   * because a MEEPLE of that colour still works. That is the whole reason the
   * five doors are listed even when only three are on the table.
   */
  owner: string | null;
  size?: 'full' | 'rail';
  /** Draw the pawn beside the action, which is what makes the legend a key. */
  showMeeple?: boolean;
}) {
  const meta = SUIT_META[door.colour];
  return (
    <div
      className={`door door-${size}`}
      style={{ borderColor: meta.pip }}
      title={`${meta.label}: ${door.actionText}`}
    >
      {size === 'full' && <img className="door-art" src={doorArt(door.action)} alt="" />}
      {showMeeple && <Meeple colour={door.colour} size={size === 'rail' ? 15 : 22} title="" />}
      <div className="door-body">
        <span className="door-name">
          <span className="door-verb">{door.actionLabel}</span>
          <em>{owner ?? 'nobody farms this crop'}</em>
        </span>
        {size === 'full' && <span className="door-action">{door.actionText}</span>}
      </div>
    </div>
  );
}
