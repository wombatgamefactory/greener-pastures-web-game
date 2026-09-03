/**
 * THE WORKER POOL: the same plan, spread over the cores that were sitting idle.
 *
 * ## Why it exists now, having been refused twice
 *
 * `run.ts` said "single-core on purpose" and gave the arithmetic: a full run was
 * ninety seconds, so parallelism would have been engineering for its own sake.
 * That arithmetic died with v31's branching factor, and even with the option
 * collapse in @gp/bots the suite is a baseline plus five mirrors plus however
 * many sweep arms - roughly eleven thousand games. On one core of twenty-four
 * that is a coffee break per arm and nobody iterates a design at that price.
 *
 * ## THE ONE THING THAT MATTERS: the result must not depend on the schedule
 *
 * Paired arms ARE the method here. A run whose numbers move when the machine is
 * busy is not an instrument, so determinism is not a nice property of this file,
 * it is the whole specification. Three things buy it, and all three are cheap
 * because a game was already an island:
 *
 *   1. **A game is a pure function of its job.** Its seed, its seating, its
 *      profiles and its policy rng streams all derive from
 *      `${runSeed}:${seats}:${cell}:${i}` and nothing else. No game reads
 *      another game's state; no worker shares anything but the read-only
 *      `GameData` it was handed at birth.
 *   2. **Results are written by INDEX, never appended.** The jobs are numbered
 *      off the plan before any worker starts, and each result lands at its own
 *      slot, so `result.games` comes back in exactly the order the single-core
 *      loop produced it. Whoever finishes first changes nothing.
 *   3. **Nothing downstream reads completion order.** `onGame` is a progress
 *      line and is called with a COUNT, not a game; crash captures carry their
 *      own cell and index.
 *
 * `--workers=1` runs the jobs inline on this thread with no worker at all, which
 * is both the debugging path and the control arm for proving the above.
 *
 * ## Why worker threads and not child processes
 *
 * `GameData` is one structured clone per worker at startup (a hundred-odd plain
 * objects), and `GameMetrics` is one clone per game on the way back. A process
 * pool would pay JSON on both legs and lose the `Map` in `GameMetrics.cards`.
 */

import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';

import type { GameData } from '@gp/data';
import type { Capture } from '@gp/engine';

import type { GameMetrics } from './observe.js';
import type { GameJob, JobResult } from './job.js';
import { runJob } from './job.js';

/** What a worker is handed once, at birth. */
export interface WorkerBoot {
  readonly data: GameData;
  readonly maxMoves: number;
  readonly overlay: string | null;
}

/** A job in, a result out. The wire is deliberately this small. */
type WorkerMessage =
  { readonly index: number; readonly result: JobResult } | { readonly fatal: string };

export interface PoolOptions {
  readonly data: GameData;
  readonly jobs: readonly GameJob[];
  readonly maxMoves: number;
  readonly overlay: string | null;
  /** 1 runs inline. Anything higher spawns that many threads, capped at the job count. */
  readonly workers: number;
  readonly onGame?: ((done: number, total: number) => void) | undefined;
  readonly onCrash?: ((capture: Capture) => void) | undefined;
}

export interface PoolResult {
  readonly games: readonly GameMetrics[];
}

/**
 * A sensible default worker count: leave one core for the OS and for whoever is
 * watching the progress line. Read once rather than per call so a run cannot
 * change shape halfway through.
 */
export function defaultWorkers(): number {
  return Math.max(1, cpus().length - 1);
}

export async function runJobs(opts: PoolOptions): Promise<PoolResult> {
  const total = opts.jobs.length;
  const games: (GameMetrics | undefined)[] = new Array<GameMetrics | undefined>(total);
  let done = 0;

  const land = (index: number, result: JobResult): void => {
    games[index] = result.metrics;
    if (result.capture && opts.onCrash) opts.onCrash(result.capture);
    done += 1;
    opts.onGame?.(done, total);
  };

  const threads = Math.min(Math.max(1, Math.floor(opts.workers)), Math.max(1, total));

  if (threads === 1) {
    // The control arm, and the debugging path: identical code, no thread.
    for (let i = 0; i < total; i++) {
      land(i, runJob(opts.data, opts.jobs[i] as GameJob, opts.maxMoves, opts.overlay));
    }
    return { games: games as GameMetrics[] };
  }

  await new Promise<void>((resolve, reject) => {
    // Through the .mjs bootstrap, never straight at the .ts - see worker-boot.mjs.
    const url = new URL('./worker-boot.mjs', import.meta.url);
    const boot: WorkerBoot = { data: opts.data, maxMoves: opts.maxMoves, overlay: opts.overlay };
    const workers: Worker[] = [];
    // ONE SHARED CURSOR, and this is why the schedule cannot leak into the
    // result: a worker takes the next unclaimed job rather than a pre-assigned
    // block, so a slow game delays nothing but itself, and every result still
    // lands at its own index.
    let next = 0;
    let finished = 0;
    let failed = false;

    const stop = (): void => {
      for (const w of workers) void w.terminate();
    };

    const feed = (w: Worker): void => {
      if (next >= total) {
        // Nothing left: retire this worker rather than leaving it parked.
        void w.terminate();
        return;
      }
      const index = next++;
      w.postMessage({ index, job: opts.jobs[index] });
    };

    for (let t = 0; t < threads; t++) {
      const worker = new Worker(url, { workerData: boot });
      workers.push(worker);
      worker.on('message', (message: WorkerMessage) => {
        if (failed) return;
        if ('fatal' in message) {
          failed = true;
          stop();
          reject(new Error(`sim worker: ${message.fatal}`));
          return;
        }
        land(message.index, message.result);
        finished += 1;
        if (finished === total) {
          stop();
          resolve();
          return;
        }
        feed(worker);
      });
      worker.on('error', (error: Error) => {
        if (failed) return;
        failed = true;
        stop();
        reject(error);
      });
      feed(worker);
    }

    // Fewer jobs than threads is legal and self-resolving; a plan with none is
    // not, so it is short-circuited before any worker is built.
    if (total === 0) {
      stop();
      resolve();
    }
  });

  for (let i = 0; i < total; i++) {
    if (games[i] === undefined) throw new Error(`sim pool: game ${i} never came back`);
  }
  return { games: games as GameMetrics[] };
}
