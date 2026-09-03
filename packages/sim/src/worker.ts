/**
 * THE WORKER SIDE OF THE POOL, and deliberately almost nothing.
 *
 * It boots with the run's `GameData` (one structured clone, at birth), then
 * answers jobs one at a time. Everything that could differ between a threaded
 * run and a single-core one is kept OUT of here: no seeding, no seating, no
 * plan arithmetic, no I/O. It calls `runJob`, which is the same function the
 * inline path calls.
 *
 * A throw is reported rather than swallowed. `runJob` already catches an engine
 * crash inside a game and returns it as a `crashed` outcome plus a capture, so
 * anything that reaches this catch is a bug in the harness itself and must take
 * the run down loudly rather than silently costing it a game.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { runJob } from './job.js';
import type { GameJob } from './job.js';
import type { WorkerBoot } from './pool.js';

const boot = workerData as WorkerBoot;
const port = parentPort;
if (!port) throw new Error('sim worker started outside a worker thread');

port.on('message', (message: { index: number; job: GameJob }) => {
  try {
    const result = runJob(boot.data, message.job, boot.maxMoves, boot.overlay);
    port.postMessage({ index: message.index, result });
  } catch (error) {
    port.postMessage({
      fatal: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
});
