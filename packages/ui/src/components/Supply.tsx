/**
 * A PLAYER'S MEEPLE SUPPLY, and the start-of-turn window it is spent in.
 *
 * Two shapes of the same object, because two surfaces need it at two sizes:
 *
 *   full   your own, in the farm's header: every colour you hold, clickable,
 *          with the action each one buys written beside it while the window is
 *          open. This is where the meeple phase actually happens.
 *   rail   a neighbour's, compressed to coloured pawns and counts. It answers
 *          the one cross-table question a supply raises - what free actions is
 *          that farm sitting on - which is the same job the coin count used to
 *          do on that panel and does it with more information, because a
 *          meeple's colour says what it buys.
 *
 * ⭐ THE WINDOW IS DRAWN, NOT INFERRED. A meeple may only be spent at the very
 * start of your turn - before the bonus option and before the action - and it is
 * removed from the game when spent, so a player who does not notice the window
 * has silently lost a stored action for the rest of the game. The strip
 * therefore says which of FOUR states it is in, in words:
 *
 *   open    "spend them now" - there is at least one legal `spendMeeple`
 *   shut    you hold meeples and the window has PASSED this turn
 *   stuck   you hold meeples, the window is OPEN, and not one of them has a
 *           legal action right now
 *   empty   you hold none, and the strip says where they come from
 *
 * ⚠️ `stuck` IS SPLIT OUT FROM `shut` BECAUSE THE TWO HAVE DIFFERENT ANSWERS AND
 * THE WRONG ONE IS CHECKABLE. Both look identical from the move list - no
 * `spendMeeple` on offer - and the first draft collapsed them, which put "the
 * window has passed" on screen at a moment when the window was demonstrably
 * still open (the bonus slot beside it was still live). It happens because the
 * engine refuses a meeple whose colour's action could do nothing: no full
 * building to Harvest, no legal Deliver, no room to Sow. A player told the wrong
 * reason will go looking for a rule that does not exist.
 *
 * The window itself is read off the TURN rather than off the move list, which is
 * the only place the two facts separate: `meepleOpen` in the engine is
 * `!actionSpent && bonusUsed.length === 0`, and both halves are on the view.
 */

import type { GameData, Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { SUIT_META } from '../view/suits';
import { doorOf, meepleTally } from '../view/table';
import { Meeple } from './Meeple';

/** Which of the four states the meeple phase is in, for this seat, right now. */
export type MeeplePhase = 'open' | 'shut' | 'stuck' | 'empty';

/**
 * The engine's `meepleOpen`, read off the view: the very start of your turn,
 * before the bonus option and before the action. Both clauses are the rule and
 * neither is redundant - the second is what stops a meeple being held back and
 * spent after the bonus.
 */
export function meepleWindowOpen(turn: PlayerView['turn']): boolean {
  return !turn.actionSpent && turn.bonusUsed.length === 0;
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
   * there is no window to be in: it falls back to "the window has passed", which
   * is the true reading of somebody else's turn.
   */
  turn?: PlayerView['turn'] | undefined;
}) {
  const held = meepleTally(meeples);
  const spendable = play?.active ? play.live.meeples : new Set<Suit>();
  const phase = meeplePhaseOf(meeples, spendable, turn !== undefined && meepleWindowOpen(turn));

  if (size === 'rail') {
    return (
      <p className="supply supply-rail" aria-label="meeples held">
        {held.length === 0 ? (
          <span className="supply-none">no meeples</span>
        ) : (
          held.map(([colour, n]) => (
            <span key={colour} className="supply-pawn">
              <Meeple
                colour={colour}
                size={14}
                title={`${n} ${SUIT_META[colour].label} meeple${n === 1 ? '' : 's'}: ${doorOf(data, colour).actionLabel}`}
              />
              {n > 1 && <b>{n}</b>}
            </span>
          ))
        )}
      </p>
    );
  }

  return (
    <section className={`supply supply-full supply-${phase}`} aria-label="your meeples">
      <h4 className="supply-head">
        {label ?? 'Meeples'}{' '}
        <em>
          {phase === 'open'
            ? 'spend them now, before anything else'
            : phase === 'stuck'
              ? 'none of them has anything to do right now'
              : phase === 'shut'
                ? 'your turn has moved on - they keep'
                : 'one comes with every island delivery'}
        </em>
      </h4>
      <div className="supply-row">
        {held.length === 0 && (
          <p className="empty-note">None yet. Deliver to the island and take the meeple with it.</p>
        )}
        {held.map(([colour, n]) => {
          const door = doorOf(data, colour);
          const live = spendable.has(colour);
          const title = `${SUIT_META[colour].label} meeple: ${door.actionText} Spending it removes it from the game.`;
          return (
            <button
              key={colour}
              type="button"
              className={`supply-meeple${mark(play, live)}`}
              disabled={!live}
              title={title}
              onClick={live ? () => play?.meeple(colour) : undefined}
            >
              <Meeple colour={colour} size={26} title="" />
              <span className="supply-meeple-body">
                <span className="supply-verb">{door.actionLabel}</span>
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
