/**
 * The session: a whole game played through the interface's own entry points.
 *
 * The engine already has full-game tests; what is new here is the seam ticket
 * 25 adds - a mutable session with bots on the other seats, a move log, and
 * undo as replay. The properties worth pinning are the ones that would rot
 * silently: that a session is a pure function of (seed, log), that undo really
 * rewinds rather than approximately rewinding, and that `moves` is empty
 * whenever the decision is not yours, which is what stops any interface path
 * acting out of turn.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { Move } from '@gp/engine';

import { Session, YOU } from './table';
import type { SessionOptions } from './table';

/**
 * ⏱️ WHY THREE CASES IN THIS FILE CARRY AN EXPLICIT TIMEOUT.
 *
 * They are the only UI tests that drive the REAL bots over a whole game, and a
 * scored bot move costs what it costs: measured on 02/09/2026 against the v31
 * engine, `policy.choose` with a prober averages 36ms and peaks at 138ms, with
 * no interface in the loop at all. A full three-seat game is ~420 moves and the
 * warm-up walk is up to 440, so the floor for these three is 8s, 8s and 40s -
 * every one of them past vitest's 5s default, and none of it anything a UI
 * change can move.
 *
 * The number is generous rather than tight on purpose. A budget set just above
 * the measurement turns into a flake the first time a card gets a wider option
 * list, and a flaky timeout is read as noise rather than as a finding - which is
 * exactly how a real hang would get waved through. What is being asserted here
 * is that the session TERMINATES and stays consistent, not how fast it does it;
 * if bot cost is worth watching, the simulator is where it is watched.
 */
const WHOLE_GAME = 120_000;

const THREE: SessionOptions = {
  seats: 3,
  suits: ['wheat', 'vegetable', 'orchard'],
  seed: 'session-a',
  opponents: ['balanced', 'socialite', 'racer'],
};

/**
 * Play to the end with the human seat driven by the same policy as the bots.
 * The point is not the quality of play; it is that every decision the interface
 * would be asked to make can be taken through `send`, and that the game
 * terminates.
 */
function playOut(session: Session, budget = 1600): { moves: number; over: boolean } {
  let moves = 0;
  for (let i = 0; i < budget; i++) {
    const snap = session.snapshot();
    if (snap.over) return { moves, over: true };
    if (snap.yours) {
      const move = snap.moves[moves % snap.moves.length] as Move;
      session.send(move);
    } else if (!session.stepBot()) {
      return { moves, over: false };
    }
    moves++;
  }
  return { moves, over: session.snapshot().over };
}

describe('a session plays a whole game', () => {
  it(
    'reaches the end trigger with bots on the other seats',
    () => {
      const session = new Session(data, THREE);
      const result = playOut(session);
      // A locked table (ticket 34) is a legitimate outcome and not this test's
      // business; what must not happen is an exception or a wedged position.
      expect(result.moves).toBeGreaterThan(50);
      const snap = session.snapshot();
      expect(snap.over || snap.moves.length === 0 || !snap.yours).toBe(true);
    },
    WHOLE_GAME,
  );

  it(
    'offers moves only when the decision is yours',
    () => {
      const session = new Session(data, THREE);
      for (let i = 0; i < 220; i++) {
        const snap = session.snapshot();
        if (snap.over) break;
        if (!snap.yours) {
          expect(snap.moves).toEqual([]);
          expect(session.stepBot()).toBe(true);
          continue;
        }
        expect(snap.moves.length).toBeGreaterThan(0);
        // Everything offered belongs to your seat: a task addressed to a rival is
        // never yours to answer.
        for (const move of snap.moves) expect(move.seat).toBe(YOU);
        session.send(snap.moves[0] as Move);
      }
    },
    WHOLE_GAME,
  );
});

describe('undo is replay-a-prefix', () => {
  it('lands exactly where a fresh session replaying the surviving log lands', () => {
    const session = new Session(data, THREE);
    let taken = 0;
    while (taken < 5) {
      const snap = session.snapshot();
      if (snap.over) break;
      if (!snap.yours) {
        session.stepBot();
        continue;
      }
      session.send(snap.moves[0] as Move);
      taken++;
    }
    const before = JSON.stringify(session.snapshot().view);
    expect(session.snapshot().canUndo).toBe(true);
    expect(session.undo()).toBe(true);

    const after = session.snapshot();
    expect(JSON.stringify(after.view)).not.toEqual(before);

    // The real assertion: a session that has only ever been sent the surviving
    // log is bit-identical to the one that was rewound into it. That is what
    // makes undo an engine-free feature (ticket 04) rather than an unwind.
    const fresh = new Session(data, THREE);
    for (const move of session.history()) fresh.send(move);
    expect(JSON.stringify(fresh.snapshot().view)).toEqual(JSON.stringify(after.view));
    expect(fresh.snapshot().played).toEqual(after.played);
  });

  it('rewinds to before YOUR last move, not the bots', () => {
    const session = new Session(data, THREE);
    while (!session.snapshot().yours) session.stepBot();
    const atTurnTop = JSON.stringify(session.snapshot().view);
    session.send(session.snapshot().moves[0] as Move);
    // Let the table run on, bots and all, then rewind the one decision you took.
    for (let i = 0; i < 6; i++) {
      const snap = session.snapshot();
      if (snap.over) break;
      if (snap.yours) break;
      session.stepBot();
    }
    expect(session.undo()).toBe(true);
    expect(JSON.stringify(session.snapshot().view)).toEqual(atTurnTop);
  });

  it('will not rewind past the warm-up walk', () => {
    const session = new Session(data, THREE);
    session.warmUp(60, 3);
    expect(session.snapshot().canUndo).toBe(false);
    expect(session.undo()).toBe(false);
  });
});

describe('the warm-up walk', () => {
  it(
    'hands over a dense position on your turn',
    () => {
      const session = new Session(data, THREE);
      session.warmUp(200, 4);
      const snap = session.snapshot();
      if (!snap.over) {
        expect(snap.view.you.tableau.length).toBeGreaterThan(3);
        expect(snap.played).toBeGreaterThan(100);
      }
    },
    WHOLE_GAME,
  );
});
