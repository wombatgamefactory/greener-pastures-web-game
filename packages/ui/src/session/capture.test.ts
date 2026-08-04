/**
 * The capture button, end to end from the interface's side (ticket 31).
 *
 * The claim the button makes is not "it saved a file" - it is "the game you
 * were looking at comes back". So the test that earns its keep runs the whole
 * loop: play a session, press the button, serialise exactly what the browser
 * would download, read it back through the CLI's own parser, and replay it. If
 * anything in the payload is wrong, the replayed position diverges.
 *
 * `replayCapture` is the only place in the UI package outside `table.ts` that
 * touches the engine's game verbs, and it is in a test rather than a component.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';
import { parseCapture, replayCapture } from '@gp/engine';
import type { Move } from '@gp/engine';

import { takeCapture, uiStateOf } from './capture';
import { Session, YOU } from './table';
import type { SessionOptions } from './table';

const THREE: SessionOptions = {
  seats: 3,
  suits: ['wheat', 'vegetable', 'orchard'],
  seed: 'capture-session',
  opponents: ['balanced', 'socialite', 'racer'],
};

const IDLE_PLAY = { intent: { k: 'idle' } as const, picked: [] as const };

/** Walk a session a little way with whatever is legal, bots included. */
function walk(session: Session, steps: number): void {
  for (let i = 0; i < steps; i++) {
    const snapshot = session.snapshot();
    if (snapshot.over) return;
    if (!snapshot.yours) {
      if (!session.stepBot()) return;
      continue;
    }
    const move = snapshot.moves[i % snapshot.moves.length];
    if (!move) return;
    session.send(move);
  }
}

describe('taking a capture', () => {
  it('downloads a payload that replays to the same position', () => {
    const session = new Session(data, THREE);
    walk(session, 60);
    const played = session.history().length;

    const taken = takeCapture(
      session,
      IDLE_PLAY,
      { label: 'bug', note: 'odd' },
      '2026-08-02T00:00:00.000Z',
    );

    // Exactly the bytes `downloadJson` would write, and exactly the parse the
    // replay CLI does. Nothing is handed over in memory.
    const onDisk = parseCapture(JSON.parse(JSON.stringify(taken.capture)));
    const result = replayCapture(data, onDisk);

    expect(result.fingerprintMatches).toBe(true);
    expect(result.threw).toBeNull();
    expect(result.applied).toBe(played);
    expect(taken.filename).toMatch(/^gp-bug-.*\.json$/);
  });

  it('records who was in the other chairs', () => {
    const session = new Session(data, THREE);
    const taken = takeCapture(session, IDLE_PLAY, { label: 'bug', note: '' }, 'now');
    expect(taken.capture.policies).toEqual(['human', 'socialite', 'racer']);
    expect(taken.capture.seat).toBe(YOU);
  });

  it('includes the warm-up walk, so a demo position reproduces too', () => {
    const session = new Session(data, THREE);
    session.warmUp(80, 4);
    const taken = takeCapture(session, IDLE_PLAY, { label: 'design-note', note: '' }, 'now');
    expect(taken.capture.moves.length).toBe(session.history().length);
    expect(replayCapture(data, taken.capture).threw).toBeNull();
  });

  it('can be taken mid-task, and says which task', () => {
    // Mid-effect states are where bugs live, so the button must not be gated on
    // a settled position. Walk until a task is pending and capture there.
    const session = new Session(data, THREE);
    for (let i = 0; i < 400; i++) {
      const snapshot = session.snapshot();
      if (snapshot.over) break;
      if (snapshot.view.tasks.length > 0 && snapshot.yours) break;
      if (snapshot.yours) {
        const move = snapshot.moves.find((m: Move) => m.type === 'draw') ?? snapshot.moves[0];
        if (!move) break;
        session.send(move);
      } else if (!session.stepBot()) break;
    }
    const view = session.snapshot().view;
    expect(view.tasks.length).toBeGreaterThan(0);

    const taken = takeCapture(session, IDLE_PLAY, { label: 'bug', note: '' }, 'now');
    expect(taken.capture.ui?.task).toBe(view.tasks[0]?.t);
    // And it still replays: taking a capture applies no move.
    expect(replayCapture(data, taken.capture).threw).toBeNull();
  });

  it('records what was in your hands, and calls idle idle', () => {
    expect(uiStateOf(IDLE_PLAY).intent).toBeNull();
    const held = uiStateOf({ intent: { k: 'hold', card: 'W7' }, picked: ['W3'] });
    expect(held.intent).toEqual({ k: 'hold', card: 'W7' });
    expect(held.picked).toEqual(['W3']);
  });
});
