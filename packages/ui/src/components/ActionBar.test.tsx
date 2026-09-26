/**
 * B18 (25/09/2026): "do not auto-pass the turn after the last action when
 * that action revealed new information; show End turn as the primary
 * control with a gentle ready state."
 *
 * ⚠️ FOUND WHILE BUILDING THE SCRIPTED CHECK FOR THIS: the engine itself ends
 * a turn automatically the moment nothing is left to decide
 * (`packages/engine/src/turnflow.ts`'s `finishTurn` gate - open only while the
 * bonus is still reachable, a Worker is spendable, or a standing move
 * exists). Reached through a warmed random walk, an action that reveals
 * something (a Draw, a Harvest) very often ALSO leaves nothing else legal, so
 * the turn ends inside the very same `send()` call and the human never sees
 * an "End turn" button at all - there is nothing for a UI-level fix to
 * intercept, and nothing here tries to (the interface still never constructs
 * or withholds a move). The "ready" look this ticket asks for is for the
 * genuine remaining case: the action is spent, but a Worker or a standing
 * move keeps the turn open and "End turn" is a real click away. This test
 * pins the LOOK directly against a hand-built position in that shape, since a
 * random warm-up walk hits it too rarely to search for reliably (confirmed by
 * hand while writing `.scratch/wp3a/verify-wp3a.mjs`).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Move, PlayerView } from '@gp/engine';

import { data } from '../session/table';
import type { Play } from '../session/play';
import { liveTargets } from '../view/intent';
import { ActionBar } from './ActionBar';

function view(): PlayerView {
  return {
    seat: 0,
    seats: 2,
    suitsInPlay: ['wheat', 'vegetable'],
    turnPlayer: 0,
    phase: 'playing',
    endTrigger: null,
    you: {
      suit: 'wheat',
      // A held Worker is what keeps the turn open after the action - see the
      // file banner: this is the one shape `finishTurn` does not auto-end.
      meeples: { wheat: 1, vegetable: 0, orchard: 0, apiary: 0, dairy: 0 },
      hand: [],
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
    tasks: [],
    resume: null,
  } as unknown as PlayerView;
}

function actionBarPlay(moves: readonly Move[], revealed: boolean): Play {
  const noop = () => {};
  const intent = { k: 'idle' as const };
  const v = view();
  return {
    active: true,
    view: v,
    moves,
    intent,
    live: liveTargets(v, moves, intent),
    picked: [],
    commitments: [],
    subsetKind: null,
    revealed,
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

describe('End turn gets a "ready" look once something was just revealed (B18)', () => {
  const endTurnMoves: Move[] = [{ type: 'endTurn', seat: 0 }];

  it('is a plain exit button when nothing was revealed this turn', () => {
    const play = actionBarPlay(endTurnMoves, false);
    const html = renderToStaticMarkup(
      <ActionBar data={data} play={play} onUndo={() => {}} canUndo={false} waitingOn={null} />,
    );
    expect(html).not.toContain('exit primary is-target');
  });

  it('is drawn as the primary, pulsing control once a Draw or Harvest revealed something', () => {
    const play = actionBarPlay(endTurnMoves, true);
    const html = renderToStaticMarkup(
      <ActionBar data={data} play={play} onUndo={() => {}} canUndo={false} waitingOn={null} />,
    );
    expect(html).toContain('exit primary is-target');
  });

  it('never sends a move on its own - the ready look changes appearance only', () => {
    let sent: Move | null = null;
    const play = { ...actionBarPlay(endTurnMoves, true), send: (m: Move) => (sent = m) };
    renderToStaticMarkup(
      <ActionBar data={data} play={play} onUndo={() => {}} canUndo={false} waitingOn={null} />,
    );
    expect(sent).toBeNull();
  });
});
