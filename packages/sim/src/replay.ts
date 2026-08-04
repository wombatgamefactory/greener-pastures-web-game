/**
 * `gp-sim --replay` - turn a captured report back into the game that produced
 * it (ticket 31).
 *
 * This is the half that makes the capture button worth having. A file is
 * handed to a Claude session or read at a terminal, and the bug is standing
 * there again: the same shuffle, the same hands, the same move that threw, plus
 * the legal move list at the moment it went wrong.
 *
 * It lives in @gp/sim because reading a file is exactly what the engine may not
 * do. Everything below the I/O is `replayCapture`, which is `newGame` and
 * `apply` and nothing else - there is no replay mode in the engine to disagree
 * with normal play.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { GameData } from '@gp/data';
import {
  captureFilename,
  describeCapture,
  parseCapture,
  replayCapture,
  toFixture,
} from '@gp/engine';
import type { Capture, Move, ReplayResult } from '@gp/engine';

export interface ReplayRequest {
  readonly path: string;
  /** Replay anyway when the data has moved on since the capture. */
  readonly force: boolean;
  /** Write a public-side regression fixture, with this as its `why`. */
  readonly fixture: string | null;
  /** Where a fixture is written. */
  readonly fixtureDir: string;
  /** How many of the legal moves at the failure point to print. */
  readonly top: number;
}

export interface ReplayOutcome {
  readonly report: string;
  /** 0 replayed clean, 1 reproduced a throw, 2 refused (data has moved on). */
  readonly code: number;
}

export function readCapture(path: string): Capture {
  return parseCapture(JSON.parse(readFileSync(path, 'utf8')));
}

/** Write a capture into `dir`, under its own name. Returns the path. */
export function writeCapture(dir: string, capture: Capture): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, captureFilename(capture));
  writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Write every crashed game out as a capture (ticket 31, decision 4).
 *
 * A balance run already catches an engine throw and names it, but the evidence
 * used to die with the process: ticket 30's bug killed a 1510-game run at game
 * 751 and the seed had to be re-found by hand. This makes it a replayable file
 * the moment it happens, and `--replay --fixture` turns that file into a
 * committed regression test.
 *
 * Capped, because a systematic bug crashes hundreds of games and writing
 * hundreds of near-identical files helps nobody. The count is still reported in
 * full, so the cap never hides the scale.
 */
export const CRASH_CAPTURE_LIMIT = 10;

export interface CrashWriter {
  onCrash(capture: Capture): void;
  /** What was seen and what was written. Empty when nothing crashed. */
  summary(): string;
  readonly files: readonly string[];
}

export function crashWriter(dir: string, limit = CRASH_CAPTURE_LIMIT): CrashWriter {
  const files: string[] = [];
  let seen = 0;
  return {
    files,
    onCrash(capture) {
      seen += 1;
      if (files.length >= limit) return;
      files.push(writeCapture(dir, capture));
    },
    summary() {
      if (seen === 0) return '';
      return (
        `\n  ${seen} game(s) crashed. Captured ${files.length} of them:\n` +
        files.map((f) => `    ${f}\n`).join('') +
        `  Replay one with: npm run sim -- --replay=${files[0] ?? ''}\n\n`
      );
    },
  };
}

export function replayReport(data: GameData, request: ReplayRequest): ReplayOutcome {
  const capture = readCapture(request.path);
  const result = replayCapture(data, capture, { force: request.force });
  const out: string[] = ['', describeCapture(capture), ''];

  // The readable record comes FIRST and is printed whatever happens next.
  // Ticket 31 settled that a stale report degrades rather than dies: the sheet
  // moves and the numbers with it, but "the Draw Worker feels too strong on
  // turn 12" keeps every bit of its value. Only the replay is lost.
  if (!result.fingerprintMatches) {
    out.push(
      '  DATA HAS MOVED ON',
      `    captured against  ${result.expectedFingerprint}`,
      `    this build has    ${result.actualFingerprint}`,
      '',
    );
    if (!request.force) {
      out.push(
        '  The record above still stands; the replay does not. A log is legal against the',
        '  numbers it was recorded under, so replaying it here would prove nothing about',
        '  either build. Re-run with --force to try anyway.',
        '',
      );
      return { report: `${out.join('\n')}\n`, code: 2 };
    }
    out.push('  --force: replaying against the current data anyway.', '');
  }

  out.push(...replayLines(capture, result, request.top));

  if (request.fixture !== null) {
    out.push(...writeFixture(capture, request, result));
  }

  return { report: `${out.join('\n')}\n`, code: result.threw ? 1 : 0 };
}

function replayLines(capture: Capture, result: ReplayResult, top: number): string[] {
  const out: string[] = [];
  const total = capture.moves.length;

  if (result.threw) {
    const { at, move, error, legal } = result.threw;
    out.push(
      '  REPRODUCED',
      `    applied ${at} of ${total} moves, then move ${at} threw:`,
      `      ${error}`,
      '',
      '    the move that threw',
      `      ${JSON.stringify(move)}`,
      '',
      `    what was legal in that position (${legal.length})`,
      ...summariseMoves(legal, top).map((line) => `      ${line}`),
      '',
      '  To dig in: replay the same log one move shorter and inspect the position.',
      '  A fix is done when this file replays clean - see --fixture.',
    );
    return out;
  }

  if (result.endedEarly) {
    out.push(
      '  ENDED EARLY',
      `    applied ${result.applied} of ${total} moves before the game was already over.`,
      '    The log outlives the game, which is itself a bug worth looking at.',
    );
    return out;
  }

  out.push('  REPLAYED CLEAN', `    all ${total} moves applied, ${result.turns} turns.`);

  // A capture that recorded a throw and now replays clean is either fixed or
  // was never in the log. Both are worth saying out loud, and the probe below
  // is what tells them apart.
  if (capture.error !== null) {
    out.push('', `    the capture recorded a throw: ${capture.error}`);
    if (result.next?.error) {
      out.push(
        '    and it is STILL THERE, one step past the end of the log - the throw came from',
        '    enumerating the position, not from applying a move:',
        `      ${result.next.error}`,
      );
      return out;
    }
    out.push(
      '    but the replay did not hit it. Either it is fixed, or the log stops short of it.',
      `    The position after the log offers ${result.next?.count ?? 0} legal moves.`,
    );
    return out;
  }

  if (result.next?.error) {
    out.push(
      '',
      '    NOTE: the position after the log cannot enumerate its legal moves:',
      `      ${result.next.error}`,
    );
  } else if (result.next && result.next.count === 0) {
    out.push('', '    NOTE: no legal moves in the final position, and the game has not ended.');
  }
  return out;
}

/**
 * Legal moves, grouped by type. A raw list of 90 build variants tells a reader
 * nothing; "build x74, draw x10" plus the first few of each is the shape.
 */
function summariseMoves(moves: readonly Move[], top: number): string[] {
  if (moves.length === 0) return ['(none)'];
  const byType = new Map<string, Move[]>();
  for (const move of moves) {
    const list = byType.get(move.type) ?? [];
    list.push(move);
    byType.set(move.type, list);
  }
  const out: string[] = [];
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${type} x${list.length}`);
    for (const move of list.slice(0, top)) out.push(`  ${JSON.stringify(move)}`);
    if (list.length > top) out.push(`  ... ${list.length - top} more`);
  }
  return out;
}

/**
 * Report to fixture: the path from a captured bug to a committed regression
 * test.
 *
 * The stripping is the point. A capture carries a human's note and the design
 * material in it, and both sit on the private side of the disclosure boundary;
 * a fixture is committed and goes public with the repo. `toFixture` names the
 * fields it keeps rather than deleting the ones it does not, so a field added
 * to the capture later cannot leak by being forgotten.
 */
function writeFixture(capture: Capture, request: ReplayRequest, result: ReplayResult): string[] {
  const fixture = toFixture(capture, request.fixture ?? '');
  const name = `${capture.setup.seats}p-${capture.setup.seed.replace(/[^a-z0-9]+/gi, '-')}.json`;
  const file = join(request.fixtureDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return [
    '',
    '  FIXTURE WRITTEN',
    `    ${file}`,
    `    expect: ${fixture.expect}${result.threw ? ' (red until the bug is fixed)' : ''}`,
    '    The note did not travel. `fixtures.test.ts` replays every file in that folder.',
  ];
}
