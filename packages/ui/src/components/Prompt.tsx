/**
 * The prompt surface: the one strip that says what the game is waiting for.
 *
 * Four things share it, because at any moment at most one of them is live: a
 * pending task, the build assembly, the visit assembly, and the disambiguation
 * menu a click opens when it matched more than one move. Giving them one place
 * on screen is what stops the interface sprouting modals - and it means the
 * answer to "why can I not click anything" is always in the same spot.
 *
 * The fallback list at the bottom is load-bearing rather than lazy. Most tasks
 * are answered in place (a building, a deck, a tile), but the engine's task
 * vocabulary has an escape hatch for card-specific choices, and the discard has
 * subsets no in-place gesture covers. Listing the legal answers in English
 * guarantees ticket 25's "every task answerable" without a bespoke surface per
 * card - and if a future card DOES need one, the fallback is what keeps the
 * game playable until it is written.
 */

import type { GameData } from '@gp/data';
import type { Move } from '@gp/engine';

import type { Play } from '../session/play';
import { answersOfKind, pendingTask, subsetAnswer } from '../view/intent';
import { describeMove, describeTask } from '../view/moveText';
import { printedFace } from '../view/printed';
import { BuildPanel } from './BuildPanel';
import { Card } from './Card';
import { VisitPanel } from './VisitPanel';
import type { Zoomer } from './Zoom';

/** The see-N half of a draw: the cards turned over, waiting to be kept or let go. */
function Revealed({
  data,
  play,
  cards,
  zoom,
}: {
  data: GameData;
  play: Play;
  cards: readonly string[];
  zoom: Zoomer;
}) {
  return (
    <div className="revealed" onMouseLeave={() => zoom.clear()}>
      {cards.map((id, i) => (
        <button
          key={`${id}-${i}`}
          className={`revealed-card${play.picked.includes(id) ? ' is-picked' : ''}`}
          onMouseEnter={() => zoom.show(id)}
          onClick={() => play.hold(id)}
        >
          <Card face={printedFace(data, id)} width={110} />
        </button>
      ))}
    </div>
  );
}

function Menu({
  data,
  play,
  title,
  moves,
}: {
  data: GameData;
  play: Play;
  title: string;
  moves: readonly Move[];
}) {
  return (
    <div className="prompt-menu">
      <p className="prompt-line">{title}</p>
      <div className="answer-list">
        {moves.map((move, i) => (
          <button key={i} className="answer" onClick={() => play.send(move)}>
            {describeMove(data, play.view, move)}
          </button>
        ))}
        <button className="ghost" onClick={play.cancel}>
          cancel
        </button>
      </div>
    </div>
  );
}

export function Prompt({ data, play, zoom }: { data: GameData; play: Play; zoom: Zoomer }) {
  const intent = play.intent;

  if (intent.k === 'choose') {
    return (
      <section className="prompt" aria-live="polite">
        <Menu data={data} play={play} title={intent.title} moves={intent.moves} />
      </section>
    );
  }
  if (intent.k === 'build') {
    return (
      <section className="prompt" aria-live="polite">
        <BuildPanel data={data} play={play} draft={intent.draft} />
      </section>
    );
  }
  if (intent.k === 'visit') {
    return (
      <section className="prompt" aria-live="polite">
        <VisitPanel data={data} play={play} host={intent.host} fee={intent.fee} />
      </section>
    );
  }

  const task = pendingTask(play.view);
  if (task === null) {
    if (intent.k === 'hold') {
      return (
        <section className="prompt prompt-quiet" aria-live="polite">
          <p className="prompt-line">
            Card in hand. The places it can go are lit - a neighbour&rsquo;s Notice Board, or one of
            your own buildings. Escape puts it back.
          </p>
        </section>
      );
    }
    if (intent.k === 'arm') {
      return (
        <section className="prompt prompt-quiet" aria-live="polite">
          <p className="prompt-line">Choose a target for {intent.type}. Escape cancels.</p>
        </section>
      );
    }
    return null;
  }

  // A task is live. Anything answerable in place is already glowing where it
  // lives; what needs a surface of its own is here.
  const skip = answersOfKind(play.moves, 'skip')[0];
  const confirm =
    play.subsetKind === null ? null : subsetAnswer(play.moves, play.subsetKind, play.picked);

  return (
    <section className="prompt" aria-live="polite">
      <p className="prompt-line">{describeTask(data, task)}</p>

      {task.t === 'draw' && task.revealed.length > 0 && (
        <Revealed data={data} play={play} cards={task.revealed} zoom={zoom} />
      )}

      <div className="answer-list">
        {confirm && (
          <button className="primary" onClick={() => play.send(confirm)}>
            {play.subsetKind === 'keep'
              ? `Keep ${play.picked.length}`
              : `Discard ${play.picked.length}`}
          </button>
        )}
        {skip && (
          <button className="ghost" onClick={() => play.send(skip.move)}>
            no thanks
          </button>
        )}
        {/* The escape hatch, and the safety net: any answer with no in-place
            gesture is still one click away. */}
        {play.moves
          .filter((m) => m.type === 'task' && m.answer.kind === 'card')
          .map((move, i) => (
            <button key={i} className="answer" onClick={() => play.send(move)}>
              {describeMove(data, play.view, move)}
            </button>
          ))}
      </div>
    </section>
  );
}
