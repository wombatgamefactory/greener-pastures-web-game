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
 * ⚠️ IT IS DRAWN RATHER THAN PAINTED (since 26/09/2026 the drawing is the
 * farmer silhouette traced from `images/meeple.png`, see WORKER_PATH), and that is a decision rather than a
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

/**
 * ⭐ 26/09/2026 (Dean): the Worker is the farmer silhouette from
 * `images/meeple.png` (wide-brimmed hat, round body, two legs), traced once
 * with OpenCV into this one closed path in a 26.44 x 32 box. It replaces the
 * generic board-game pawn. Still a flat fill in the action colour with an ink
 * keyline, for every reason given in the header above.
 */
const WORKER_PATH =
  'M11.01 0.30 L9.98 0.75 L9.29 1.31 L7.03 5.29 L4.42 5.77 L2.39 6.38 L1.52 6.76 L0.87 7.16 L0.35 7.63 L0.10 8.04 L0.00 8.59 L0.19 9.17 L0.67 9.69 L1.39 10.18 L2.37 10.62 L3.77 11.07 L6.41 11.60 L6.59 13.00 L6.78 13.65 L7.10 14.36 L7.92 15.46 L8.91 16.25 L7.44 16.91 L6.19 17.66 L4.90 18.65 L3.89 19.63 L2.95 20.77 L1.92 22.29 L1.70 23.03 L1.76 23.78 L2.02 24.34 L2.34 24.73 L2.87 25.09 L3.48 25.27 L4.05 25.25 L4.53 25.11 L5.93 24.15 L5.70 25.85 L5.66 27.75 L5.80 29.68 L6.14 31.52 L5.27 32.00 L12.42 32.00 L12.42 29.39 L12.58 29.04 L12.82 28.83 L13.08 28.73 L13.40 28.73 L13.68 28.84 L14.02 29.26 L14.05 32.00 L21.18 32.00 L20.33 31.54 L20.65 29.74 L20.80 27.99 L20.75 25.78 L20.53 24.15 L21.97 25.13 L22.53 25.27 L23.30 25.21 L24.05 24.79 L24.55 24.16 L24.76 23.51 L24.73 22.80 L24.52 22.24 L23.56 20.82 L22.72 19.79 L21.71 18.78 L20.74 17.98 L19.69 17.27 L18.59 16.68 L17.56 16.25 L18.09 15.88 L18.72 15.29 L19.44 14.23 L19.89 12.96 L20.06 11.55 L21.01 11.46 L22.64 11.09 L23.97 10.67 L25.01 10.21 L25.72 9.76 L26.20 9.28 L26.44 8.77 L26.42 8.19 L26.15 7.68 L25.67 7.21 L25.05 6.81 L24.21 6.43 L22.26 5.82 L19.44 5.29 L17.31 1.51 L16.95 1.09 L16.39 0.71 L15.13 0.21 L13.88 0.00 L12.27 0.03Z';

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
  title?: string | undefined;
  className?: string;
}) {
  const action = workerActionLabel(data)[colour];
  /*
   * ⭐ FIXED 25/09/2026 (WP5 item 1, axe `svg-img-alt` on the result screen).
   * `Door.tsx` and `Supply.tsx` both pass `title=""` ON PURPOSE, to suppress
   * this SVG's own native tooltip where the surrounding button already
   * carries a fuller one - `title=""` was never meant to say "and give this
   * `role="img"` element no accessible name either", but `??` only catches
   * `null`/`undefined`, so an explicit empty string slipped past it and left
   * `aria-label=""` (and an empty `<title></title>`, equally unhelpful) on
   * every meeple drawn that way. `||` treats the empty string the same as
   * "no title given" for BOTH the label and whether the `<title>` element is
   * worth rendering at all, which is what every caller actually wants: a
   * real accessible name always, and a native tooltip only when one was
   * explicitly written.
   */
  const accessibleLabel = title || `${action} Worker`;
  return (
    <svg
      className={`meeple ${className}`}
      viewBox="-1 -1 28.44 34"
      width={Math.round((size * 28.44) / 34)}
      height={size}
      role="img"
      aria-label={accessibleLabel}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {/* The farmer silhouette (WORKER_PATH): one path so the fill and the
          stroke cannot disagree at a join. */}
      <path
        d={WORKER_PATH}
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
      {/*
       * ⭐ FIXED 25/09/2026 (WP5 item 1, axe `svg-img-alt` on the result
       * screen): this used to pass `title ?? ''`. An explicit empty STRING is
       * not `undefined`, so it defeated `Meeple`'s own `title ?? \`${action}
       * Worker\`` fallback (leaving `aria-label=""`) AND its
       * `title !== undefined` check (rendering an empty `<title></title>`
       * inside the SVG) - two ways to say nothing where `Meeple` already knew
       * a good default. Passing `title` through unchanged lets that default
       * do its job whenever this component's own caller has not named one.
       */}
      <Meeple data={data} colour={colour} size={size} title={title} />
      <b>{count}</b>
    </span>
  );
}
