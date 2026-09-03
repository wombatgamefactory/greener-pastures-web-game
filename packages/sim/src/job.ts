/**
 * ONE GAME, as a self-contained unit of work.
 *
 * Split out of `runBalance`'s loop body so the single-core path and the worker
 * pool run LITERALLY the same code rather than two copies that agree today. A
 * balance run's entire claim to reproducibility rests on a game being a pure
 * function of its job, and the cheapest way to keep that true is to have one
 * function that takes the job.
 *
 * Everything a game needs is decided by the caller and carried here as plain
 * data - seed, seating, neutral decks, profile ids - because a job crosses a
 * `postMessage` boundary and must be structured-cloneable. In particular the
 * SEATING is passed rather than the cell: `seatingFor` rotates who sits where
 * with the game index, and a worker that re-derived it would be one refactor
 * away from re-deriving it differently.
 */

import type { GameData, Suit } from '@gp/data';
import { makeCapture } from '@gp/engine';
import type { Capture } from '@gp/engine';
import type { PolicyId } from '@gp/bots';

import { runGame } from './driver.js';
import { Fold } from './observe.js';
import type { GameMetrics } from './observe.js';

export interface GameJob {
  /** Position in the plan. The result lands at this index, whoever finishes first. */
  readonly index: number;
  readonly seats: number;
  readonly cell: string;
  /** Who actually sits where, already rotated. NOT the cell's canonical order. */
  readonly seating: readonly Suit[];
  readonly neutral: readonly Suit[];
  readonly profiles: readonly PolicyId[];
  readonly seed: string;
  /** The game's index within its cell, and the cell's size. Crash notes only. */
  readonly inCell: number;
  readonly cellGames: number;
}

export interface JobResult {
  readonly metrics: GameMetrics;
  /** Present only when the engine threw: the ready-made capture envelope. */
  readonly capture?: Capture;
}

export function runJob(
  data: GameData,
  job: GameJob,
  maxMoves: number,
  overlay: string | null,
): JobResult {
  const fold = new Fold(
    data,
    {
      seed: job.seed,
      cell: job.cell,
      suits: [...job.seating],
      neutral: [...job.neutral],
      profiles: [...job.profiles],
    },
    job.seats,
  );
  const result = runGame(data, {
    seed: job.seed,
    seats: job.seats,
    suits: [...job.seating],
    neutralSuits: [...job.neutral],
    policies: [...job.profiles],
    maxMoves,
    observe: (d) => fold.observe(d),
  });
  const metrics = fold.finish(result.state, result.outcome, result.chooseMs, result.error ?? null);
  if (result.outcome !== 'crashed') return { metrics };
  return {
    metrics,
    capture: makeCapture({
      label: 'bug',
      // The note is the run's own account of itself. A simulator capture has no
      // human behind it, so this is what a reader gets instead.
      note:
        `Emitted automatically by a balance run.\n` +
        `Cell ${job.cell} at ${job.seats} seats, game ${job.inCell} of ${job.cellGames}.`,
      at: new Date().toISOString(),
      origin: 'sim',
      dataFingerprint: result.state.dataFingerprint,
      setup: {
        seed: job.seed,
        seats: job.seats,
        // The SEATING, not the cell's canonical order: a capture that replays a
        // different seating replays a different game.
        suits: [...job.seating],
        neutralSuits: [...job.neutral],
      },
      policies: [...job.profiles],
      // The attempted move is appended so the replay throws in the same place
      // rather than reaching the crash position and stopping cleanly. It is
      // absent when the throw came from `legalMoves`, and then the log alone
      // reaches the position that cannot enumerate.
      moves: result.attempted ? [...result.moves, result.attempted] : result.moves,
      seat: result.state.turnPlayer,
      turn: result.turns,
      overlay,
      error: result.error ?? null,
    }),
  };
}
