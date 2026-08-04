/**
 * The simulator's automatic capture on a crash (ticket 31, decision 4).
 *
 * The reason this is in scope at all is a specific piece of history: ticket
 * 30's bug killed a 1510-game run at game 751, and the evidence died with the
 * process - the seed had to be re-found by hand afterwards. The driver already
 * catches an engine throw and names it; this proves the throw now leaves a
 * replayable artifact behind.
 *
 * The subtle half is `attempted`. A run's move log records APPLIED moves, so
 * the throwing move is not in it - and a capture built from the log alone
 * reaches the crash position and then replays perfectly clean, which reads as
 * "not reproducible" when the truth is "the log was one move short". That is
 * exactly the failure this test exists to prevent, so it asserts both halves:
 * without the attempted move the replay is clean, with it the replay throws in
 * the same place with the same message.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';
import { makeCapture, parseCapture, replayCapture } from '@gp/engine';
import type { Move } from '@gp/engine';
import type { Policy } from '@gp/bots';

import { runGame } from './driver.js';
import { crashWriter } from './replay.js';

const SPEC = {
  seed: 'crash-capture',
  seats: 2,
  suits: ['wheat', 'vegetable'] as const,
  neutralSuits: ['orchard'] as const,
};

/**
 * A bot that plays properly for a while and then offers a move nobody was
 * offered. `apply` re-validates everything (ticket 04), so this reproduces the
 * shape of any real engine throw without needing a real bug to be open.
 */
function saboteur(after: number): Policy {
  let seen = 0;
  return {
    id: 'saboteur',
    choose({ moves }) {
      seen += 1;
      if (seen > after) {
        return { type: 'harvest', seat: moves[0]?.seat ?? 0, building: 'W1' } as unknown as Move;
      }
      return moves[0] as Move;
    },
  };
}

const result = runGame(data, {
  ...SPEC,
  suits: [...SPEC.suits],
  neutralSuits: [...SPEC.neutralSuits],
  policies: [saboteur(30), 'pulse'],
});

describe('a crashed simulator game', () => {
  it('is named rather than swallowed', () => {
    expect(result.outcome).toBe('crashed');
    expect(result.error).toBeTruthy();
  });

  it('carries the move that threw, which is NOT in the applied log', () => {
    expect(result.attempted).toBeTruthy();
    expect(result.moves).not.toContainEqual(result.attempted);
  });

  it('replays clean from the log alone - which is why the log alone is not enough', () => {
    const short = capture(result.moves);
    const replayed = replayCapture(data, short);
    expect(replayed.threw).toBeNull();
    expect(replayed.applied).toBe(result.moves.length);
  });

  it('reproduces the throw, in the same place, with the attempted move appended', () => {
    const full = capture([...result.moves, result.attempted as Move]);
    const replayed = replayCapture(data, full);
    expect(replayed.threw).not.toBeNull();
    expect(replayed.threw?.at).toBe(result.moves.length);
    expect(replayed.threw?.error).toBe(result.error);
    // And the reader gets the position's own legal list to compare against.
    expect(replayed.threw?.legal.length).toBeGreaterThan(0);
  });

  it('counts turns the same way the reader does', () => {
    // The turn number in a report is only worth printing if the writer and the
    // reader agree on it. Both count `turnPlayer` changing, and neither counts
    // seat changes in the log - a cross-player task answer carries a rival's
    // seat without ending a turn, which overstated a real 3-seat game by 147
    // against a true 133 the first time a capture was ever replayed.
    expect(replayCapture(data, capture(result.moves)).turns).toBe(result.turns);
  });
});

/**
 * The writer itself, which is the one part of this path that will almost never
 * run in anger - a clean engine crashes no games - and would therefore rot
 * unnoticed until the day it is needed most.
 */
describe('the crash writer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-crash-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a file that reads back as a capture', () => {
    const writer = crashWriter(dir);
    writer.onCrash(capture(result.moves));
    expect(writer.files.length).toBe(1);
    const reread = parseCapture(JSON.parse(readFileSync(writer.files[0] as string, 'utf8')));
    expect(reread.moves.length).toBe(result.moves.length);
    expect(reread.origin).toBe('sim');
  });

  it('caps the files but never the count, so the cap cannot hide the scale', () => {
    const writer = crashWriter(dir, 2);
    for (let i = 0; i < 5; i++) writer.onCrash(capture(result.moves.slice(0, i + 1)));
    expect(writer.files.length).toBe(2);
    expect(writer.summary()).toContain('5 game(s) crashed');
    expect(writer.summary()).toContain('Captured 2');
  });

  it('says nothing at all when nothing crashed', () => {
    expect(crashWriter(dir).summary()).toBe('');
  });
});

function capture(moves: readonly Move[]) {
  return makeCapture({
    label: 'bug',
    note: 'emitted by a balance run',
    at: '2026-08-02T00:00:00.000Z',
    origin: 'sim',
    dataFingerprint: `${data.cards.meta.sourceSha256 ?? 'unknown'}+base`,
    setup: {
      seed: SPEC.seed,
      seats: SPEC.seats,
      suits: [...SPEC.suits],
      neutralSuits: [...SPEC.neutralSuits],
    },
    policies: ['saboteur', 'pulse'],
    moves,
    seat: 0,
    turn: 1,
    error: 'boom',
  });
}
