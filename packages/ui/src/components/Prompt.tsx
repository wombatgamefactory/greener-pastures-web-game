/**
 * The prompt surface: the one strip that says what the game is waiting for.
 *
 * ⭐ FIVE THINGS SHARE IT (18/09/2026, was four), because at any moment at most
 * one of them is live: a pending task, the build assembly, the visit assembly,
 * the deliver assembly (2.5.1), and the disambiguation menu a click opens when
 * it matched more than one move. Giving them one place on screen is what stops
 * the interface sprouting modals - and it means the answer to "why can I not
 * click anything" is always in the same spot.
 *
 * The fallback list at the bottom is load-bearing rather than lazy. Most tasks
 * are answered in place (a building, a deck, a tile, or - since 18/09/2026,
 * 2.2.2 - a hand card picked up for `handToBarn`), but the engine's task
 * vocabulary has an escape hatch for card-specific choices, and the discard has
 * subsets no in-place gesture covers. Listing the legal answers in English
 * guarantees ticket 25's "every task answerable" without a bespoke surface per
 * card - and if a future card DOES need one, the fallback is what keeps the
 * game playable until it is written.
 */

import type { GameData } from '@gp/data';
import type { Move } from '@gp/engine';
import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Play } from '../session/play';
import { dropZone } from '../view/drop';
import { answersOfKind, clickHandCard, pendingTask, subsetAnswer } from '../view/intent';
import { describeMove, describeTask } from '../view/moveText';
import { printedFace } from '../view/printed';
import { BuildPanel, DeliverPanel } from './BuildPanel';
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
  const width = useDeckWidth();
  return (
    <div className="revealed" onMouseLeave={() => zoom.clear()}>
      {cards.map((id, i) => (
        <button
          key={`${id}-${i}`}
          className={`revealed-card${play.picked.includes(id) ? ' is-picked' : ''}`}
          onMouseEnter={() => zoom.show(id)}
          onClick={() => play.hold(id)}
        >
          <Card face={printedFace(data, id)} width={width} />
        </button>
      ))}
    </div>
  );
}

/**
 * T10b (26/09/2026): a revealed card is drawn at the DECK's size on the
 * ladder rather than a fixed 110px, now that it sits in the tray under the
 * decks it came off: 110px was a thumbnail at 2560 and too tall for the
 * space under the decks at the 1024 floor.
 */
function useDeckWidth(): number {
  const [px, setPx] = useState(110);
  useLayoutEffect(() => {
    const v = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--card-deck'),
    );
    if (Number.isFinite(v) && v > 0 && v !== px) setPx(v);
  });
  return px;
}

/**
 * The eligible hand for a `handToBarn` task (B12, 25/09/2026).
 *
 * "Any task answered by clicking cards highlights the eligible cards" - the
 * hand fan already does this (`liveHand`'s `holdLeadsSomewhere` branch reads
 * `clickHandCard` too, so the same cards glow where they sit), but the prompt
 * used to say only "put N cards into your barn" with nothing on the strip
 * itself to click or to look at, which is exactly the "no highlighted cards,
 * no buttons" the appraisal caught (`visit-card-chosen-1600.png`). This
 * mirrors `Revealed`: the SAME cards, drawn small enough to fit the prompt, so
 * the task is answerable without hunting them down elsewhere in the hand.
 *
 * ⚠️ NOT A CONFIRM-STYLE PICKER. Every `handToBarn` task built today is
 * mandatory (`orchard.test.ts`: "Mandatory: which card, never whether") and
 * `clickHandCard` resolves a click straight to its move - there is no partial
 * selection to hold before sending, so clicking a card here plays it at once,
 * the same as clicking it in the fan does.
 */
function EligibleHand({
  data,
  play,
  cards,
}: {
  data: GameData;
  play: Play;
  cards: readonly string[];
}) {
  const width = useDeckWidth();
  if (cards.length === 0) return null;
  return (
    <div className="revealed" aria-label="cards you may put in your barn">
      {cards.map((id) => (
        <button key={id} className="revealed-card" onClick={() => play.hold(id)}>
          <Card face={printedFace(data, id)} width={width} />
        </button>
      ))}
    </div>
  );
}

/**
 * T10b (26/09/2026): THE TASK TRAY, AND WHY A TASK'S CARDS LIVE UNDER THE DECKS.
 *
 * A task prompt used to be a row of the main column, in normal flow between
 * the turn bar and the farm. Its sentence was one line, but a Draw's revealed
 * card, a hand-to-barn follow-up's eligible cards and an answer list made it
 * three or four lines, and every line pushed the whole farm down mid-turn:
 * 85px at 1600x900 for the Draw reveal, taking the hand and the Farmstead
 * receipts off the bottom of the screen (QA D2). The first fix for that docked
 * every prompt as a sheet over the top of the shared table, and it covered the
 * very decks a Draw asks you to click (`main-column.css`, the dock note).
 *
 * So the prompt is split in two. The SENTENCE goes in the turn bar's fixed
 * message line (`ActionBar`'s `.bar-line`). The PARTS - revealed cards,
 * eligible cards, answer buttons, the disambiguation menu - go to this tray,
 * which `SharedTable` mounts in the decks panel BELOW the deck backs, over the
 * space under the decks and never over a deck back itself (`shared-table.css`,
 * `.task-tray`). The deck backs, the island's tiles, the rivals' boards and
 * your own farm are the only things a task ever asks you to click on the
 * table, and the tray covers none of them: it sits in the decks' own column,
 * so the island beside it is untouched, and it stops short of the deck backs.
 * A Draw's revealed card coming to rest just under the deck it came off is
 * also simply where the eye expects it.
 *
 * ⚠️ A PORTAL, WITH AN INLINE FALLBACK. The render tests draw this component
 * with no shared table (and `renderToStaticMarkup` has no DOM at all), so the
 * tray renders inline wherever the host is missing - every answer is still in
 * the markup and still one click away.
 */
function useTrayHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // No dependency list on purpose: re-checked every render, so a remounted
  // shared table is picked up rather than a detached node kept.
  useLayoutEffect(() => {
    const el = document.getElementById('task-tray');
    if (el !== host) setHost(el);
  });
  return host;
}

function Tray({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  const tray = (
    <div className="prompt-tray" role="group" aria-label="choices for this step">
      {children}
    </div>
  );
  return host ? createPortal(tray, host) : tray;
}

function MenuAnswers({
  data,
  play,
  moves,
}: {
  data: GameData;
  play: Play;
  moves: readonly Move[];
}) {
  return (
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
  );
}

/**
 * T10b (26/09/2026): the armed family's name as a player reads it. The arm
 * note used to print the raw move type ("Choose a target for deliver.", QA
 * D10), a programmer's lower-case verb in the middle of a sentence.
 */
const ARM_NAMES: Readonly<Record<string, string>> = {
  deliver: 'your delivery',
  build: 'your Build',
  grow: 'your Grow',
  harvest: 'your Harvest',
  draw: 'your Draw',
  visit: 'your visit',
  spendMeeple: 'your Worker',
};

function armName(type: string): string {
  return ARM_NAMES[type] ?? 'this';
}

export function Prompt({ data, play, zoom }: { data: GameData; play: Play; zoom: Zoomer }) {
  const intent = play.intent;
  const host = useTrayHost();

  if (intent.k === 'choose') {
    return (
      <section className="prompt prompt-menu" aria-live="polite">
        <p className="prompt-line" title={intent.title}>
          {intent.title}
        </p>
        <Tray host={host}>
          <MenuAnswers data={data} play={play} moves={intent.moves} />
        </Tray>
      </section>
    );
  }
  // Both assemblies take a hand card as a DROP as well as a click: a build is
  // paid one card at a time and the two-card visit needs a second, which is the
  // one place a drag has more than one card to carry.
  if (intent.k === 'build') {
    return (
      <section className="prompt" aria-live="polite" {...dropZone('assembly')}>
        <BuildPanel data={data} play={play} draft={intent.draft} />
      </section>
    );
  }
  if (intent.k === 'visit') {
    return (
      <section className="prompt" aria-live="polite" {...dropZone('assembly')}>
        <VisitPanel data={data} play={play} host={intent.host} fee={intent.fee} />
      </section>
    );
  }
  // A delivery is paid from the barn, never carried by drag from the hand
  // (2.5.1) - no `dropZone`, unlike build and visit, for the same reason
  // `DROP_FAMILIES` marks tiles `null` in `view/drop.ts`.
  if (intent.k === 'deliver') {
    return (
      <section className="prompt" aria-live="polite">
        <DeliverPanel play={play} draft={intent.draft} />
      </section>
    );
  }

  const task = pendingTask(play.view);
  if (task === null) {
    if (intent.k === 'hold') {
      return (
        <section className="prompt prompt-quiet" aria-live="polite">
          <p className="prompt-line">
            Card in hand: the places it can go are lit - a neighbour&rsquo;s Notice Board, or one of
            your buildings. Escape puts it back.
          </p>
        </section>
      );
    }
    if (intent.k === 'arm') {
      return (
        <section className="prompt prompt-quiet" aria-live="polite">
          <p className="prompt-line">
            Choose a target for {armName(intent.type)}: the places it can go are lit. Escape
            cancels.
          </p>
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

  const eligible =
    task.t === 'handToBarn'
      ? play.view.you.hand.filter((card) => clickHandCard(play.moves, card).length > 0)
      : [];
  const cardAnswers = play.moves.filter((m) => m.type === 'task' && m.answer.kind === 'card');
  const revealed = task.t === 'draw' && task.revealed.length > 0;
  const answers = confirm !== null || skip !== undefined || cardAnswers.length > 0;
  const line = describeTask(data, task);

  return (
    <section className="prompt" aria-live="polite">
      <p className="prompt-line" title={line}>
        {line}
      </p>

      {(revealed || eligible.length > 0 || answers) && (
        <Tray host={host}>
          {task.t === 'draw' && revealed && (
            <Revealed data={data} play={play} cards={task.revealed} zoom={zoom} />
          )}

          {/* B12 (25/09/2026): the Wheat and Vegetable boards' hand-to-barn
              follow-up shows the cards it can be answered with, not just the
              sentence saying so. `skip` above already draws "no thanks" whenever
              the task genuinely offers one to decline with - every one built
              today does not (it is mandatory, R1 in `tasks.ts`), so there is
              nothing to add beyond the cards themselves: clicking one plays it,
              same as picking it up from the fan does. */}
          {task.t === 'handToBarn' && <EligibleHand data={data} play={play} cards={eligible} />}

          {answers && (
            <div className="answer-list">
              {confirm && (
                <button className="primary" onClick={() => play.send(confirm)}>
                  {/* ⭐ The two subset tasks are opposite in sign and the button has to
                      say which one it is (02/09/2026, with the hand limit): a keep
                      names what you are taking, a boundary discard names what you are
                      losing, and "Keep 2" on a discard would be exactly backwards. */}
                  {play.subsetKind === 'discard' ? 'Discard' : 'Keep'} {play.picked.length}
                </button>
              )}
              {skip && (
                <button className="ghost" onClick={() => play.send(skip.move)}>
                  no thanks
                </button>
              )}
              {/* The escape hatch, and the safety net: any answer with no in-place
                  gesture is still one click away. */}
              {cardAnswers.map((move, i) => (
                <button key={i} className="answer" onClick={() => play.send(move)}>
                  {describeMove(data, play.view, move)}
                </button>
              ))}
            </div>
          )}
        </Tray>
      )}
    </section>
  );
}
