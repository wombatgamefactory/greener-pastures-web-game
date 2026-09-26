/**
 * B12 (25/09/2026): "any task answered by clicking cards highlights the
 * eligible cards and shows explicit Done/Skip controls." The appraisal's
 * example is the Vegetable board's fallback ("Deliver. If you cannot, put 2
 * cards from your hand into your barn.", `visit-card-chosen-1600.png`): the
 * prompt showed the sentence and nothing else to click or look at.
 *
 * Built as a hand-written fixture rather than a warmed game search: the
 * fallback only fires when a visit's Deliver could not happen, which a bot
 * warm-up walk hits rarely and unpredictably, and the property under test -
 * does the prompt draw the eligible cards and the right controls for a
 * `handToBarn` task - depends only on `play.view.tasks[0]` and `play.moves`,
 * neither of which needs a real game behind it to be honest.
 *
 * ⚠️ EVERY `handToBarn` TASK THE ENGINE PUSHES TODAY IS MANDATORY
 * (`packages/engine/src/handlers/orchard.test.ts`: "Mandatory: which card,
 * never whether") - there is no `skip` answer in the move list for one, ever,
 * so the fixture does not invent one either. What the prompt owes a mandatory
 * task is the cards themselves, clickable, which is what this pins.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Move, PlayerView, Task } from '@gp/engine';

import { data } from '../session/table';
import type { Play } from '../session/play';
import { liveTargets } from '../view/intent';
import { Prompt } from './Prompt';
import type { Zoomer } from './Zoom';

const zoom: Zoomer = { current: null, show: () => {}, clear: () => {} };

/**
 * A minimal view sitting on a `handToBarn` task, built by hand rather than
 * enumerating every `PlayerView` field - the same escape hatch `App.tsx`'s
 * `EMPTY_VIEW` placeholder uses, for the same reason: this fixture is read by
 * `Prompt.tsx` for its hand, its tasks and its seat, and nothing else.
 */
function handToBarnView(task: Task): PlayerView {
  return {
    seat: 0,
    seats: 3,
    suitsInPlay: ['wheat', 'vegetable', 'orchard'],
    turnPlayer: 0,
    phase: 'playing',
    endTrigger: null,
    you: {
      suit: 'vegetable',
      meeples: { wheat: 0, vegetable: 0, orchard: 0, apiary: 0, dairy: 0 },
      // V4 is eligible (a move names it below); V5 sits in the same hand but
      // is not - the point of the fixture is that the prompt draws exactly
      // what the move list offers, never the whole hand.
      hand: ['V4', 'V5'],
      barn: {},
      tableau: [],
      receipts: [],
    },
    rivals: [],
    decks: {},
    discards: {},
    fair: [],
    island: { tiles: [] },
    turn: {
      actionSpent: true,
      bonusUsed: ['visit'],
      ending: false,
      onceUsed: [],
      firedThisTurn: [],
    },
    tasks: [task],
    resume: 'bonus',
  } as unknown as PlayerView;
}

function staticPlay(view: PlayerView, moves: readonly Move[]): Play {
  const noop = () => {};
  const intent = { k: 'idle' as const };
  return {
    active: true,
    view,
    moves,
    intent,
    live: liveTargets(view, moves, intent),
    picked: [],
    commitments: [],
    subsetKind: null,
    revealed: false,
    send: noop,
    choose: noop,
    cancel: noop,
    arm: noop,
    hold: noop,
    startBuild: noop,
    setDraft: noop,
    setVisitFee: noop,
    setDeliverDraft: noop,
    building: noop,
    cardPower: noop,
    host: noop,
    tile: noop,
    meeple: noop,
    deck: noop,
  };
}

describe('the Vegetable/Wheat board fallback (handToBarn) exposes its cards (B12)', () => {
  // Mandatory: 2 to place, no `optional` flag - matches every `handToBarn`
  // task the engine actually pushes (`workers.ts`'s board fallbacks, W4, W10,
  // O17, V4, V12...).
  const task: Task = { t: 'handToBarn', pid: 0, src: 'V3', remaining: 2 };
  const view = handToBarnView(task);
  const moves: Move[] = [{ type: 'task', seat: 0, answer: { kind: 'handToBarn', card: 'V4' } }];
  const play = staticPlay(view, moves);
  const html = renderToStaticMarkup(<Prompt data={data} play={play} zoom={zoom} />);

  it('states the task as mandatory, not "you may" - the fallback never offers a decline', () => {
    expect(html).toContain('Put 2 cards from your hand into your barn.');
    expect(html).not.toContain('You may put');
  });

  it('draws the eligible card as a clickable button', () => {
    expect(html).toContain('revealed-card');
  });

  it('never draws a hand card the move list does not actually offer', () => {
    // V5 sits in the same hand but no move names it - the grid must not
    // invent a click that would throw when taken.
    const cardCount = (html.match(/revealed-card/g) ?? []).length;
    expect(cardCount).toBe(1);
  });

  it('draws no skip control, because this task is mandatory and the engine offers none', () => {
    expect(html).not.toContain('no thanks');
  });
});

describe('an OPTIONAL handToBarn task (a future card) still gets an explicit Skip', () => {
  // The `optional` flag is on the task shape for exactly this: a future card
  // that genuinely offers the choice. Nothing here is reachable today (every
  // built `handToBarn` task omits the flag), but the prompt's generic
  // `skip` lookup (`answersOfKind(moves, 'skip')`) already covers it, and
  // this is what proves that path is real rather than dead.
  const task: Task = { t: 'handToBarn', pid: 0, src: 'V3', remaining: 1, optional: true };
  const view = handToBarnView(task);
  const moves: Move[] = [
    { type: 'task', seat: 0, answer: { kind: 'handToBarn', card: 'V4' } },
    { type: 'task', seat: 0, answer: { kind: 'skip' } },
  ];
  const play = staticPlay(view, moves);
  const html = renderToStaticMarkup(<Prompt data={data} play={play} zoom={zoom} />);

  it('says "you may", and draws a Skip control', () => {
    expect(html).toContain('You may put');
    expect(html).toContain('no thanks');
  });
});
