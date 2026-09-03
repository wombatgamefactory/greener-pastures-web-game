/**
 * THE MEEPLE: the component v31 put in place of the coin, and the one piece the
 * interface had never had to draw.
 *
 * It is a wooden pawn on the physical table, one per island delivery space,
 * placed face up at setup and claimed with the delivery. Its COLOUR is the whole
 * of its rules text - a meeple performs its colour's door action, free, once, at
 * the start of a turn, and then leaves the game - so a meeple that does not read
 * as its colour at a glance is a meeple that says nothing at all.
 *
 * ⚠️ IT IS DRAWN RATHER THAN PAINTED, and that is a decision rather than a
 * placeholder. `tokens/meeple.webp` exists and is a lovely illustrated farmer;
 * it is one picture, in one palette, and the rule here needs FIVE that separate
 * from each other at 14px on a delivery space. A flat pawn silhouette filled
 * with `SUIT_META.pip` - the same value the stack gauge and the receipts already
 * use - is the only version that keeps the colours apart at that size and stays
 * consistent with every other colour-carrying object on the table. If painted
 * meeples in five colours are ever commissioned they land in `tokens/` and this
 * component is the single place that changes.
 *
 * The outline is `--ink` at a fixed width so a pale Dairy meeple still has an
 * edge on a cream ground, which is the same problem `suits.ts` solved for the
 * pips and solves the same way.
 */

import type { Suit } from '@gp/data';

import { SUIT_META } from '../view/suits';

export function Meeple({
  colour,
  size = 18,
  title,
  className = '',
}: {
  colour: Suit;
  /** Height in px. The pawn's aspect is fixed, so width follows. */
  size?: number;
  title?: string;
  className?: string;
}) {
  const meta = SUIT_META[colour];
  return (
    <svg
      className={`meeple ${className}`}
      viewBox="0 0 24 32"
      width={Math.round(size * 0.75)}
      height={size}
      role="img"
      aria-label={title ?? `${meta.label} meeple`}
      focusable="false"
    >
      {title !== undefined && <title>{title}</title>}
      {/* Head, then shoulders and skirt: the standard pawn, one path so the
          fill and the stroke cannot disagree at the join. */}
      <path
        d="M12 1.5a4.6 4.6 0 0 1 0 9.2 4.6 4.6 0 0 1 0-9.2Z
           M12 10.6c4.1 0 6.2 2.6 6.4 5.8.1 1.6-.7 2.6-2 3 2.4 1.9 4 5.1 4.4 10.1H3.2
           c.4-5 2-8.2 4.4-10.1-1.3-.4-2.1-1.4-2-3 .2-3.2 2.3-5.8 6.4-5.8Z"
        fill={meta.pip}
        stroke="var(--ink, #5a4632)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A meeple with its count, as it sits in a supply. Zero draws nothing: an empty
 * colour is not a thing on the table.
 */
export function MeepleStack({
  colour,
  count,
  size = 18,
  title,
}: {
  colour: Suit;
  count: number;
  size?: number;
  title?: string;
}) {
  if (count <= 0) return null;
  return (
    <span className="meeple-stack" title={title}>
      <Meeple colour={colour} size={size} title={title ?? ''} />
      <b>{count}</b>
    </span>
  );
}
