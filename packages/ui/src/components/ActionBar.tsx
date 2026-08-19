/**
 * The turn bar: what you may do, what you have already spent, and the two exits.
 *
 * It is the guided path. The fast path is picking a card up and clicking where
 * it goes, but a gateway game has to survive someone who has never seen it, and
 * "which of the five actions is this" is the first thing that has to be legible.
 * So every family is listed whether or not it is legal, and an illegal one is
 * greyed rather than hidden: a bar that changes shape between turns teaches
 * nothing.
 *
 * Nothing here knows a rule. A family is enabled because `legalMoves` contains
 * a move of that type, and clicking it either plays the single move or arms the
 * family so its targets light up.
 */

import type { GameData } from '@gp/data';
import type { Move, PlayerView } from '@gp/engine';
import { useEffect, useState } from 'react';

import type { Play } from '../session/play';
import { actionGroups, describeMove } from '../view/moveText';

/**
 * THE BONUS WINDOW, read off the view rather than imported from the engine: the
 * slot is unspent AND the main action has not been taken (Dean, 19/08/2026).
 * `rules.turn.bonusAtStartOnly` is the paired control, so the interface honours
 * the knob rather than the rule - an arm that switches the rule back must switch
 * the interface back with it or it is measuring two different games.
 */
function bonusWindowOpen(data: GameData, view: PlayerView): boolean {
  if (view.turn.bonusSpent) return false;
  if (!data.rules.turn.bonusAtStartOnly) return true;
  return !view.turn.actionSpent;
}

function TurnState({ data, view }: { data: GameData; view: PlayerView }) {
  const { turn } = view;
  // A slot that is unspent but no longer reachable is neither "spent" nor an
  // option, and saying "bonus slot" there would be a lie the rule cannot back.
  const bonusLabel = turn.bonusSpent
    ? 'bonus spent'
    : bonusWindowOpen(data, view)
      ? 'bonus slot'
      : 'bonus missed';
  return (
    <ul className="turn-state" aria-label="what is left of your turn">
      <li className={turn.actionSpent ? 'spent' : 'unspent'}>
        {turn.actionSpent ? 'action spent' : 'action'}
      </li>
      <li className={turn.bonusSpent || !bonusWindowOpen(data, view) ? 'spent' : 'unspent'}>
        {bonusLabel}
      </li>
      {turn.again && <li className="again">one more {turn.again}, if you want it</li>}
      {turn.visit && <li className="again">a Helping Hand can repeat that Worker</li>}
    </ul>
  );
}

export function ActionBar({
  data,
  play,
  onUndo,
  canUndo,
  waitingOn,
}: {
  data: GameData;
  play: Play;
  onUndo(): void;
  canUndo: boolean;
  /** Text for whoever the table is waiting on, when it is not you. */
  waitingOn: string | null;
}) {
  const groups = actionGroups(play.moves);
  const armedType = play.intent.k === 'arm' ? play.intent.type : null;

  /**
   * THE BONUS PHASE (plan section 5.2, shape (c): modal, auto-skipped when there
   * is nothing to skip).
   *
   * Under the start-of-turn rule nothing NEEDS a skip - taking your main action
   * IS the decline, because the window is exactly "before the main action". The
   * phase is not here for legality, it is here for HONESTY: offered in one
   * undifferentiated list, the bonus silently expires the moment somebody clicks
   * Build, and players forfeit it by accident, repeatedly. A forfeited visit is
   * the hook not happening, and that is worth a click.
   *
   * It is shape (c) and not (b) because (b) charges every player one extra click
   * on every one of a 60-80 turn game: the phase appears only when the seat
   * actually HAS a legal bonus option, and otherwise the turn opens straight
   * into the main phase.
   *
   * ⚠️ THE SKIP IS LOCAL STATE AND NOT AN ENGINE MOVE, which is a deliberate
   * departure from the plan's section 5.3. A `skipBonus` move would be a strict
   * no-op - a seat that skips reaches the identical state it reaches by taking
   * its action - and adding it would put a dead move type into `MOVE_TYPES`, the
   * bots' claims-union assertion, three separate UI priority lists and the sim's
   * per-decision enumeration, all to record a button press that changes nothing.
   * The cost is that a human's explicit decline is not distinguishable from a
   * forfeit in the event stream; nothing reads that distinction, because the
   * bots never skip, so the sim could not have measured it either way.
   */
  const bonusOpen = bonusWindowOpen(data, play.view);
  const bonusGroups = groups.filter((g) => g.bonus === true);
  const bonusLive = play.active && bonusGroups.some((g) => g.moves.length > 0);
  const [skipped, setSkipped] = useState(false);
  // Reset when the window shuts, so the next turn opens its phase again.
  useEffect(() => {
    if (!bonusOpen) setSkipped(false);
  }, [bonusOpen]);
  const inBonusPhase = bonusOpen && bonusLive && !skipped;

  const onGroup = (type: Move['type'], moves: Move[], needsTarget: boolean) => {
    if (moves.length === 0) return;
    if (!needsTarget) {
      play.choose(moves, 'Which one?');
      return;
    }
    // One legal target: skip the arming step rather than making someone click a
    // family and then the only thing in it.
    if (moves.length === 1 && type !== 'build' && type !== 'visit') {
      play.send(moves[0] as Move);
      return;
    }
    play.arm(type);
  };

  return (
    <div className="actionbar" aria-label="your turn">
      {waitingOn === null ? (
        <TurnState data={data} view={play.view} />
      ) : (
        <p className="waiting-on">{waitingOn}</p>
      )}

      {inBonusPhase && (
        <p className="bonus-phase" aria-label="bonus slot, at the start of your turn">
          <strong>Your bonus, first.</strong> One of these, or skip it - the slot shuts the moment
          you take your action.
        </p>
      )}

      <div className="action-buttons">
        {(inBonusPhase ? bonusGroups : groups).map((group) => {
          const enabled = play.active && group.moves.length > 0;
          const title =
            group.moves.length === 1
              ? describeMove(data, play.view, group.moves[0] as Move)
              : `${group.hint}${group.moves.length > 0 ? ` (${group.moves.length} ways)` : ''}`;
          return (
            <button
              key={group.type}
              className={`action${armedType === group.type ? ' action-armed' : ''}`}
              disabled={!enabled}
              title={title}
              onClick={() => onGroup(group.type, group.moves, group.needsTarget)}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      {inBonusPhase && (
        <div className="bonus-exits">
          <button
            className="ghost"
            onClick={() => setSkipped(true)}
            title="take your action instead - the bonus is forfeited either way"
          >
            skip bonus action
          </button>
          {/* The main families are not hidden from the RULES, only from this
              step: taking one is still legal and still forfeits the slot. The
              button is the honest door to that, not a gate on it. */}
        </div>
      )}

      <div className="turn-exits">
        <button className="ghost" disabled={!canUndo} onClick={onUndo} title="replay without it">
          undo
        </button>
        {play.intent.k !== 'idle' && (
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
        )}
      </div>
    </div>
  );
}
