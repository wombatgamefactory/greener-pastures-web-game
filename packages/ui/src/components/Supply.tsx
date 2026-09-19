/**
 * A PLAYER'S WORKER SUPPLY, and the after-action window it is spent in.
 *
 * ⛔ THE V31 MEEPLE SUPPLY IS GONE (18/09/2026, 2.7.1): there never was a
 * shared starting bank in THIS file - that system (a starting supply of
 * meeples, killed at a table on 09/09/2026, §5 of CLAUDE.md) lived elsewhere
 * and is not this component's concern. What WAS wrong here, and is fixed by
 * this pass, is the WINDOW below: it was computed for the meeple loop's
 * start-of-turn spend, a rule this game no longer has. `meeples` is, and has
 * always been in this file, the held Worker counts a seat has taken off the
 * island with its deliveries (16/09/2026's token island, §2.8 of CLAUDE.md) -
 * exactly what 2.7.1 says to keep.
 *
 * Two shapes of the same object, because two surfaces need it at two sizes:
 *
 *   full   your own, in the farm's header: every colour you hold, clickable,
 *          with the action each one buys written beside it while the window is
 *          open. This is where the Worker spend actually happens.
 *   rail   a neighbour's, compressed to coloured pawns and counts. It answers
 *          the one cross-table question a supply raises - what free actions is
 *          that farm sitting on - which is the same job the coin count used to
 *          do on that panel and does it with more information, because a
 *          Worker's colour says what it buys.
 *
 * ⭐ THE WINDOW IS DRAWN, NOT INFERRED, AND IT SITS AFTER YOUR MAIN ACTION, ONCE
 * A TURN (`rules.turn.meepleSpendTiming` 'afterAction', `meepleSpendPerTurn` 1 -
 * the 14/09/2026 evening ruling, §2.8 of CLAUDE.md; this file previously read
 * the window as the OLD start-of-turn shape and that was the bug 2.5.3 names).
 * A Worker is removed from the game when spent, so a player who does not
 * notice the window has silently lost a stored action for the rest of the
 * turn. The strip therefore says which of FOUR states it is in, in words:
 *
 *   open    "spend one now" - there is at least one legal `spendMeeple`
 *   shut    you hold Workers and the point has not arrived yet THIS turn (you
 *           have not taken your main action)
 *   stuck   you hold Workers, your main action is DONE, and not one of them has
 *           a legal action right now (which also covers "you already spent
 *           your one this turn" - both read as "nothing to do now")
 *   empty   you hold none, and the strip says where they come from
 *
 * ⚠️ `stuck` IS SPLIT OUT FROM `shut` BECAUSE THE TWO HAVE DIFFERENT ANSWERS AND
 * THE WRONG ONE IS CHECKABLE. Both look identical from the move list - no
 * `spendMeeple` on offer - and the first draft collapsed them, which put "wait
 * for your action" on screen at a moment when nothing was left to wait for. It
 * happens because the engine refuses a Worker whose colour's action could do
 * nothing: no full building to Harvest, no legal Deliver, no room to Grow. A
 * player told the wrong reason will go looking for a rule that does not exist.
 *
 * The window itself is read off the TURN rather than off the move list, which is
 * the only place the two facts separate: the point a Worker may be spent is
 * `actionSpent === true`, and that flag is on the view.
 */

import type { GameData, Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { SUIT_META } from '../view/suits';
import { doorOf, meepleTally } from '../view/table';
import { Meeple, workerActionLabel } from './Meeple';

/**
 * The Worker's own plain action, one word plus one printed sentence.
 *
 * ⭐ 19/09/2026: NO MORE APIARY SPECIAL CASE. `workers.json`'s Apiary entry is
 * corrected (its `actionText` now describes a Grow), and the label comes from
 * `workerActionLabel` (`Meeple.tsx`), which is computed off `meepleActionOf`
 * rather than the roster's raw `action` - so all five colours now read off data
 * uniformly, including Apiary, whose door still prints `sow` for reasons
 * `workers.json`'s dated note explains but whose Worker buys `grow`.
 */
function workerAction(data: GameData, colour: Suit): { label: string; text: string } {
  return { label: workerActionLabel(data)[colour], text: doorOf(data, colour).actionText };
}

/** Which of the four states the Worker spend is in, for this seat, right now. */
export type MeeplePhase = 'open' | 'shut' | 'stuck' | 'empty';

/**
 * Has the point in the turn where a Worker may be spent arrived? Since
 * 14/09/2026 (evening) that point is AFTER the main action, not before it - the
 * opposite of what this returned when the window sat at the start of the turn.
 */
export function meepleWindowOpen(turn: PlayerView['turn']): boolean {
  return turn.actionSpent;
}

export function meeplePhaseOf(
  meeples: Readonly<Record<Suit, number>>,
  spendable: ReadonlySet<Suit>,
  windowOpen: boolean,
): MeeplePhase {
  if (spendable.size > 0) return 'open';
  if (meepleTally(meeples).length === 0) return 'empty';
  return windowOpen ? 'stuck' : 'shut';
}

export function MeepleSupply({
  data,
  meeples,
  play,
  size = 'full',
  label,
  turn,
}: {
  data: GameData;
  meeples: Readonly<Record<Suit, number>>;
  /** Absent on a neighbour's supply and on the read-only render path. */
  play?: Play | undefined;
  size?: 'full' | 'rail';
  /** Overrides the caption. The rail passes none and draws pawns only. */
  label?: string;
  /**
   * This seat's turn state, so a supply with nothing spendable can say WHICH
   * reason it is. Absent on a neighbour's panel and on the read-only path, where
   * there is no window to be in: it falls back to "do your action first", which
   * is a harmless default for a farm that is not mid-turn at all.
   */
  turn?: PlayerView['turn'] | undefined;
}) {
  const held = meepleTally(meeples);
  const spendable = play?.active ? play.live.meeples : new Set<Suit>();
  const phase = meeplePhaseOf(meeples, spendable, turn !== undefined && meepleWindowOpen(turn));

  if (size === 'rail') {
    return (
      <p className="supply supply-rail" aria-label="Workers held">
        {held.length === 0 ? (
          <span className="supply-none">no Workers</span>
        ) : (
          held.map(([colour, n]) => (
            <span key={colour} className="supply-pawn">
              <Meeple
                data={data}
                colour={colour}
                size={14}
                title={`${n} ${SUIT_META[colour].label} Worker${n === 1 ? '' : 's'}: ${workerAction(data, colour).label}`}
              />
              {n > 1 && <b>{n}</b>}
            </span>
          ))
        )}
      </p>
    );
  }

  return (
    <section className={`supply supply-full supply-${phase}`} aria-label="your Workers">
      <h4 className="supply-head">
        {label ?? 'Workers'}{' '}
        <em>
          {phase === 'open'
            ? 'spend one now, before you end your turn'
            : phase === 'stuck'
              ? 'none of them has anything to do right now'
              : phase === 'shut'
                ? 'do your action first - you may spend one afterwards'
                : 'one comes with every island delivery'}
        </em>
      </h4>
      <div className="supply-row">
        {held.length === 0 && (
          <p className="empty-note">None yet. Deliver to the island and take the Worker with it.</p>
        )}
        {held.map(([colour, n]) => {
          const action = workerAction(data, colour);
          const live = spendable.has(colour);
          const title = `${SUIT_META[colour].label} Worker: ${action.text} Spending it removes it from the game.`;
          return (
            <button
              key={colour}
              type="button"
              className={`supply-meeple${mark(play, live)}`}
              disabled={!live}
              title={title}
              onClick={live ? () => play?.meeple(colour) : undefined}
            >
              <Meeple data={data} colour={colour} size={26} title="" />
              <span className="supply-meeple-body">
                <span className="supply-verb">{action.label}</span>
                <em>
                  {n} held{n > 1 ? ', one at a time' : ''}
                </em>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
