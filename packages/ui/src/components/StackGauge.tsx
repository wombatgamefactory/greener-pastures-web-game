/**
 * The stack gauge: one pip per threshold slot, filled in the suit colour of the
 * card that went into it, with a clog state at full.
 *
 * Dean picked pips over fanned mini-cards and over `3/5` in ticket 09, for a
 * reason worth keeping in view when this is edited: the mixed-colour story has
 * to stay visible. "Your junk is their treasure" only reads if you can see that
 * a stack is full of other people's colours, so the pip carries the SUIT, not
 * just the count. A plain fraction would throw that away.
 */

import type { Suit } from '@gp/data';

import { SUIT_META } from '../view/suits';

export function StackGauge({
  stack,
  threshold,
  size = 'farm',
}: {
  stack: readonly Suit[];
  threshold: number | null;
  /** 'rail' is the compressed neighbour panel; 'farm' is your own tableau. */
  size?: 'farm' | 'rail';
}) {
  if (threshold === null) return null;
  const full = stack.length >= threshold;
  const label = `${stack.length} of ${threshold}${full ? ', full' : ''}`;

  return (
    <span
      className={`gauge gauge-${size}${full ? ' gauge-full' : ''}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: threshold }, (_, i) => {
        const suit = stack[i];
        return (
          <span
            key={i}
            className={`pip${suit ? ' pip-filled' : ''}`}
            style={suit ? { background: SUIT_META[suit].pip } : undefined}
          />
        );
      })}
      {/* Overflow: a stack can exceed its threshold only if a rule ever lets it,
          but showing it is cheaper than debugging a silently clipped gauge. */}
      {stack.length > threshold && <span className="gauge-over">+{stack.length - threshold}</span>}
    </span>
  );
}

/**
 * The Notice Board's fill, as a bar rather than pips. It reads at rail size
 * where five pips do not, and it is the one gauge a visitor scans across three
 * neighbours at once: a full board is a closed farm.
 */
export function FillBar({ filled, threshold }: { filled: number; threshold: number }) {
  const pct = threshold === 0 ? 0 : Math.min(100, (filled / threshold) * 100);
  const full = threshold > 0 && filled >= threshold;
  return (
    <span
      className={`fillbar${full ? ' fillbar-full' : ''}`}
      role="img"
      aria-label={`Notice Board ${filled} of ${threshold}${full ? ', full - no visits' : ''}`}
    >
      <span className="fillbar-track">
        <span className="fillbar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="fillbar-text">
        {filled}/{threshold}
        {full ? ' full' : ''}
      </span>
    </span>
  );
}
