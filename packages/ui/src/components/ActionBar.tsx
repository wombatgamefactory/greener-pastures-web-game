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

import type { Play } from '../session/play';
import { actionGroups, describeMove } from '../view/moveText';

function TurnState({ view }: { view: PlayerView }) {
  const { turn } = view;
  return (
    <ul className="turn-state" aria-label="what is left of your turn">
      <li className={turn.actionSpent ? 'spent' : 'unspent'}>
        {turn.actionSpent ? 'action spent' : 'action'}
      </li>
      <li className={turn.bonusSpent ? 'spent' : 'unspent'}>
        {turn.bonusSpent ? 'bonus spent' : 'bonus slot'}
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
        <TurnState view={play.view} />
      ) : (
        <p className="waiting-on">{waitingOn}</p>
      )}

      <div className="action-buttons">
        {groups.map((group) => {
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
