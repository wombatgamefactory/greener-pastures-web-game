/**
 * The capture envelope (ticket 31).
 *
 * The properties worth pinning are the ones that would rot silently and take
 * the whole point of the feature with them:
 *
 *  - a capture round-trips through JSON, because it is written by a browser and
 *    read by a CLI and never once passed in memory;
 *  - a replay reproduces a throw at the SAME move index, which is the entire
 *    claim the button makes;
 *  - a fingerprint mismatch refuses rather than lying, and the record survives;
 *  - a fixture carries no note, because a fixture is committed to a repo that
 *    goes public and a note is not.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';

import {
  captureFilename,
  describeCapture,
  makeCapture,
  parseCapture,
  replayCapture,
  replayFixture,
  toFixture,
} from './capture.js';
import type { Capture } from './capture.js';
import { apply, legalMoves } from './game.js';
import { newGame } from './setup.js';
import type { GameState, Move } from './state.js';

const SETUP = { seed: 'capture-test', seats: 3, suits: ['wheat', 'vegetable', 'orchard'] } as const;

/** Walk a few moves with a fixed rule (first legal), so the log is deterministic. */
function walk(steps: number): { moves: Move[]; state: GameState; turns: number } {
  let state = newGame(data, { seats: SETUP.seats, suits: [...SETUP.suits], seed: SETUP.seed });
  const moves: Move[] = [];
  let turns = 1;
  for (let i = 0; i < steps; i++) {
    const legal = legalMoves(data, state);
    const move = legal[i % legal.length] as Move;
    const next = apply(data, state, move).state;
    if (next.turnPlayer !== state.turnPlayer) turns += 1;
    state = next;
    moves.push(move);
  }
  return { moves, state, turns };
}

function capture(overrides: Partial<Parameters<typeof makeCapture>[0]> = {}): Capture {
  const walked = walk(24);
  return makeCapture({
    label: 'bug',
    note: 'the Draw Worker feels too strong',
    at: '2026-08-02T12:00:00.000Z',
    origin: 'ui',
    dataFingerprint: walked.state.dataFingerprint,
    setup: { seed: SETUP.seed, seats: SETUP.seats, suits: [...SETUP.suits] },
    policies: ['human', 'balanced', 'hermit'],
    moves: walked.moves,
    seat: 0,
    turn: walked.turns,
    ...overrides,
  });
}

describe('the capture envelope', () => {
  it('survives the round trip a real capture takes', () => {
    const original = capture();
    // Written by a browser as a file, read back by a CLI. Anything that does
    // not survive JSON never arrives.
    const reread = parseCapture(JSON.parse(JSON.stringify(original)));
    expect(reread).toEqual(original);
  });

  it('does not alias the caller move log', () => {
    const walked = walk(6);
    const taken = capture({ moves: walked.moves });
    walked.moves.length = 0;
    expect(taken.moves.length).toBe(6);
  });

  it('refuses a file that is not one, and says why', () => {
    expect(() => parseCapture(null)).toThrow(/not an object/);
    expect(() => parseCapture({ format: 1, label: 'nonsense' })).toThrow(/unknown label/);
    expect(() => parseCapture({ format: 99, label: 'bug' })).toThrow(/newer than this engine/);
    expect(() => parseCapture({ format: 1, label: 'bug', setup: { seed: 'x', seats: 2 } })).toThrow(
      /setup.suits/,
    );
  });

  it('names the file after its label and its time', () => {
    expect(captureFilename(capture())).toMatch(
      /^gp-bug-2026-08-02T12-00-00-000-[0-9a-f]{4}\.json$/,
    );
    expect(captureFilename(capture({ label: 'design-note' }))).toMatch(/^gp-design-note-/);
  });
});

describe('replay', () => {
  it('replays a clean log to the same place, every time', () => {
    const taken = capture();
    const first = replayCapture(data, taken);
    const second = replayCapture(data, taken);
    expect(first.threw).toBeNull();
    expect(first.applied).toBe(taken.moves.length);
    expect(first.fingerprintMatches).toBe(true);
    // Bit-identical, which is the contract everything here stands on.
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
  });

  it('reproduces a throw at the move that threw, with the legal list', () => {
    const walked = walk(12);
    // A move nobody was offered. `apply` re-validates everything (ticket 04),
    // so this stands in for any real engine throw.
    const illegal: Move = { type: 'harvest', seat: 2, building: 'W1' } as unknown as Move;
    const taken = capture({ moves: [...walked.moves, illegal] });

    const result = replayCapture(data, taken);
    expect(result.threw).not.toBeNull();
    expect(result.threw?.at).toBe(12);
    expect(result.threw?.move).toEqual(illegal);
    expect(result.applied).toBe(12);
    // The legal list at the failure is what a reader actually needs.
    expect(result.threw?.legal.length).toBeGreaterThan(0);
  });

  it('reports what the position offers next, so a legalMoves crash is visible', () => {
    const result = replayCapture(data, capture());
    expect(result.next?.error).toBeNull();
    expect(result.next?.count).toBeGreaterThan(0);
  });

  it('refuses when the data has moved on, and forces past it on request', () => {
    const stale = capture({ dataFingerprint: 'some-older-sheet+base' });

    const refused = replayCapture(data, stale);
    expect(refused.fingerprintMatches).toBe(false);
    expect(refused.state).toBeNull();
    expect(refused.applied).toBe(0);

    const forced = replayCapture(data, stale, { force: true });
    expect(forced.fingerprintMatches).toBe(false);
    expect(forced.applied).toBe(stale.moves.length);
  });

  it('keeps the record readable when the replay is refused', () => {
    // Ticket 31: a stale report degrades to a readable record rather than
    // dying. The note is the part that is still true after the numbers move.
    const text = describeCapture(capture({ dataFingerprint: 'old+base' }));
    expect(text).toContain('the Draw Worker feels too strong');
    expect(text).toContain('capture-test');
    expect(text).toContain('3 seats');
  });
});

describe('report to fixture', () => {
  it('carries the setup and the log and nothing private', () => {
    const fixture = toFixture(capture(), 'guards the opening');
    expect(Object.keys(fixture).sort()).toEqual([
      'dataFingerprint',
      'expect',
      'format',
      'moves',
      'setup',
      'why',
    ]);
    expect(JSON.stringify(fixture)).not.toContain('Draw Worker');
    expect(fixture.expect).toBe('plays');
  });

  it('is red until the bug is fixed when the capture recorded a throw', () => {
    expect(toFixture(capture({ error: 'boom' }), 'why').expect).toBe('throws');
  });

  it('replays through the same path a capture does', () => {
    const fixture = toFixture(capture(), 'guards the opening');
    expect(replayFixture(data, fixture).threw).toBeNull();
  });
});
