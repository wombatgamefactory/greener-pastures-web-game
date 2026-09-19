/**
 * THE WORKER (called "meeple" only in history), the delivery Worker that ships
 * on the token island (§2.8 of CLAUDE.md, R3/R7 16/09/2026 plus the 14/09/2026
 * evening ruling that first put it on the table). One wooden pawn per Worker,
 * seeded face up on the tile's 3 and 4 VP tokens at setup, claimed with the
 * token when a delivery takes it. Its COLOUR is the whole of its rules text - a
 * Worker is discarded AFTER your main action, at most one per turn, for the
 * PLAIN action of its colour, and then it leaves the game for good - so a
 * Worker that does not read as its colour at a glance is a Worker that says
 * nothing at all.
 *
 * ⭐ THE FIVE COLOURS ARE THE PLAYER-AID ACTION COLOURS, NOT THE CROP CARD
 * SWATCHES (18/09/2026, 2.5.5). `tools/player-aids/aid.css` is the source of
 * truth: `--draw #CA5744`, `--build #EFEDEE`, `--grow #E7963B`,
 * `--harvest #FCEB3D`, `--deliver #9CAC85`. Build and Harvest are the two that
 * actually differ from that suit's printed card swatch (Dairy's card is a
 * darker cream, Wheat's a darker gold) - CLAUDE.md §2.2 records the two crop
 * swatches sitting only 43 RGB units apart, and the aid picked white and yellow
 * for Build and Harvest precisely to pull the pair apart again. A Worker uses
 * the aid palette everywhere so the same collision never comes back on the
 * table's one wooden component that has to read at a glance from across it.
 *
 * ⭐ 19/09/2026: `workerActionLabel(data)` IS COMPUTED, NOT HAND-TYPED. It used
 * to be a literal per-suit map written here because
 * `packages/data/data/workers.json`'s apiary entry printed `action: 'sow'` and
 * reading the label straight off `doorOf` (`view/table.ts`) would have put
 * "Sow" on screen for an Apiary Worker, whose plain action has been GROW since
 * M7 (12/09/2026). That was a workaround for a stale printed sentence, not a
 * fact about this component, and it could drift the moment a rule changed
 * underneath it without anyone noticing. The roster's `actionText` is
 * corrected now (see the note dated 19/09/2026 in workers.json), and this is
 * computed straight off `meepleActionOf` (`@gp/engine`), the SAME function
 * `performDoorAction` dispatches through when a Worker is actually spent - so
 * a Worker's colour always reads as whatever it would actually buy, and a
 * further change to `rules.turn.meepleSpendTiming` or the roster moves this
 * label with it instead of leaving it to go stale again.
 *
 * ⚠️ TAKES `data` RATHER THAN CLOSING OVER THE BASE DATASET DIRECTLY
 * (19/09/2026): a module-level constant built that way would silently ignore
 * an overlay-applied run, which is exactly what `boundary.test.ts` polices -
 * every component takes `GameData` as a prop, this included.
 *
 * ⚠️ IT IS DRAWN RATHER THAN PAINTED, and that is a decision rather than a
 * placeholder. `tokens/meeple.webp` exists and is a lovely illustrated farmer;
 * it is one picture, in one palette, and the rule here needs FIVE that separate
 * from each other at 14px on a token. A flat pawn silhouette filled with the aid
 * colour is the only version that keeps the colours apart at that size and
 * stays consistent with every other colour-carrying object on the table. If
 * painted Workers in five colours are ever commissioned they land in `tokens/`
 * and this component is the single place that changes.
 *
 * The outline is `--ink` at a fixed width so a pale Build Worker still has an
 * edge on a cream ground, which is the same problem `suits.ts` solved for the
 * pips and solves the same way.
 */

import type { DoorAction, GameData, Suit } from '@gp/data';
import { meepleActionOf } from '@gp/engine';

/**
 * The five player-aid action colours, keyed by the Worker's own colour (its
 * suit). Source: `tools/player-aids/aid.css` (`--draw`/`--build`/`--grow`/
 * `--harvest`/`--deliver`), which is the aid Dean actually prints and hands out
 * at the table, not the crop card swatch table in CLAUDE.md §2.2.
 */
export const WORKER_COLOUR: Readonly<Record<Suit, string>> = {
  orchard: '#CA5744', // Draw
  dairy: '#EFEDEE', // Build
  apiary: '#E7963B', // Grow
  wheat: '#FCEB3D', // Harvest
  vegetable: '#9CAC85', // Deliver
};

/** One word per `DoorAction`, in the words CLAUDE.md §2.8 uses. */
const ACTION_WORD: Readonly<Record<DoorAction, string>> = {
  harvest: 'Harvest',
  deliver: 'Deliver',
  draw: 'Draw',
  sow: 'Sow',
  build: 'Build',
  grow: 'Grow',
};

/**
 * The plain action a Worker of this colour performs, one word. Computed off
 * `meepleActionOf(data, colour)` - the same function `performDoorAction`
 * dispatches a spent Worker through - rather than read off the roster's raw
 * `action`, so the Apiary line (whose door prints `sow` but whose Worker buys
 * `grow` under the shipped `meepleSpendTiming: 'afterAction'`) comes out right
 * without a special case. See the note above `Meeple`.
 */
export function workerActionLabel(data: GameData): Readonly<Record<Suit, string>> {
  return {
    wheat: ACTION_WORD[meepleActionOf(data, 'wheat')],
    vegetable: ACTION_WORD[meepleActionOf(data, 'vegetable')],
    orchard: ACTION_WORD[meepleActionOf(data, 'orchard')],
    apiary: ACTION_WORD[meepleActionOf(data, 'apiary')],
    dairy: ACTION_WORD[meepleActionOf(data, 'dairy')],
  };
}

export function Meeple({
  data,
  colour,
  size = 18,
  title,
  className = '',
}: {
  data: GameData;
  colour: Suit;
  /** Height in px. The pawn's aspect is fixed, so width follows. */
  size?: number;
  title?: string;
  className?: string;
}) {
  const action = workerActionLabel(data)[colour];
  return (
    <svg
      className={`meeple ${className}`}
      viewBox="0 0 24 32"
      width={Math.round(size * 0.75)}
      height={size}
      role="img"
      aria-label={title ?? `${action} Worker`}
      focusable="false"
    >
      {title !== undefined && <title>{title}</title>}
      {/* Head, then shoulders and skirt: the standard pawn, one path so the
          fill and the stroke cannot disagree at the join. */}
      <path
        d="M12 1.5a4.6 4.6 0 0 1 0 9.2 4.6 4.6 0 0 1 0-9.2Z
           M12 10.6c4.1 0 6.2 2.6 6.4 5.8.1 1.6-.7 2.6-2 3 2.4 1.9 4 5.1 4.4 10.1H3.2
           c.4-5 2-8.2 4.4-10.1-1.3-.4-2.1-1.4-2-3 .2-3.2 2.3-5.8 6.4-5.8Z"
        fill={WORKER_COLOUR[colour]}
        stroke="var(--ink, #5a4632)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A Worker with its count, as it sits in a supply. Zero draws nothing: an empty
 * colour is not a thing on the table.
 */
export function MeepleStack({
  data,
  colour,
  count,
  size = 18,
  title,
}: {
  data: GameData;
  colour: Suit;
  count: number;
  size?: number;
  title?: string;
}) {
  if (count <= 0) return null;
  return (
    <span className="meeple-stack" title={title}>
      <Meeple data={data} colour={colour} size={size} title={title ?? ''} />
      <b>{count}</b>
    </span>
  );
}
