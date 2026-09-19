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
 * neighbours at once.
 *
 * ⭐ 13/09/2026 (S8): a Notice Board's threshold is a MINIMUM, never a maximum.
 * Nothing ever blocks - a card is always welcome, and the owner simply CAN
 * harvest once the bar reads `3+`. This bar used to read as a closed farm at
 * full width, the same "full" language a clogging building earns; that was
 * true of the v31 threshold-2 board and it has not been true since the `3+`
 * ruling. It now never says "full" and never claims a visit would be
 * refused - it says how many cards are on the board and what the harvest
 * minimum is, full stop. `ready` still marks the at-or-above-threshold state
 * visually (the bar's own colour cue), because "the owner could harvest this
 * right now" is worth a glance - it just no longer means "shut".
 */
export function FillBar({ filled, threshold }: { filled: number; threshold: number }) {
  const pct = threshold === 0 ? 0 : Math.min(100, (filled / threshold) * 100);
  const ready = threshold > 0 && filled >= threshold;
  const label =
    threshold === 0
      ? `Notice Board, ${filled} card${filled === 1 ? '' : 's'}`
      : `Notice Board, ${filled} card${filled === 1 ? '' : 's'}, ${threshold}+ to harvest${ready ? ' (ready to harvest)' : ''}`;
  return (
    <span
      // The CSS hook keeps its v31 name (`fillbar-full`) so the existing rust
      // colour cue survives without a stylesheet edit; what changed is only
      // what it is claiming - "ready to harvest", never "closed".
      className={`fillbar${ready ? ' fillbar-full' : ''}`}
      role="img"
      aria-label={label}
    >
      <span className="fillbar-track">
        <span className="fillbar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="fillbar-text">
        {filled} ({threshold === 0 ? '-' : `${threshold}+`})
      </span>
    </span>
  );
}
