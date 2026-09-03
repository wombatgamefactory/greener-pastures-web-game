/**
 * THE DETERMINISM PROOF, as a test rather than as a claim in a comment.
 *
 * Paired arms are the whole method of this simulator: a sweep reads a delta
 * between two runs on the same seed, so a run whose numbers depend on how many
 * cores were free, or on which worker happened to finish first, is not an
 * instrument. This file runs one real plan at one thread and again at four, and
 * asserts the two are the same game by game, field by field.
 *
 * It is deliberately a SMALL plan run TWICE rather than a large one run once.
 * What is being tested is the scheduling, and scheduling differences show up in
 * the first few games or not at all.
 */

import { describe, expect, it } from 'vitest';

import { loadGameData } from '@gp/data';

import type { GameMetrics } from './observe.js';
import { REFERENCE } from './reference.js';
import { runBalance } from './run.js';

const data = loadGameData();

const PLAN = {
  reference: { ...REFERENCE, targetGames: { 2: 2 }, maxMoves: 2500 },
  seed: 'pool-determinism',
  games: 2,
  seatCounts: [2],
};

/** Everything a report could read off one game, as one comparable string. */
function fingerprint(g: GameMetrics): string {
  return JSON.stringify({
    seed: g.seed,
    cell: g.cell,
    suits: g.suits,
    profiles: g.profiles,
    outcome: g.outcome,
    moves: g.moves,
    rounds: g.rounds,
    winner: g.winner,
    ranking: g.ranking,
    scores: g.scores,
    turnsBySeat: g.turnsBySeat,
    deliveriesBySeat: g.deliveriesBySeat,
    visitsBySeat: g.visitsBySeat,
    selfVisitsBySeat: g.selfVisitsBySeat,
    bonusDrawBySeat: g.bonusDrawBySeat,
    actionsBySeat: g.actionsBySeat,
    meeplesSpentBySeat: g.meeplesSpentBySeat,
    barnByRound: g.barnByRound,
    doorUsesByColour: g.doorUsesByColour,
  });
}

describe('the worker pool', () => {
  it(
    'gives identical results at 1 thread and at 4, in identical order',
    { timeout: 600_000 },
    async () => {
      const one = await runBalance(data, { ...PLAN, workers: 1 });
      const four = await runBalance(data, { ...PLAN, workers: 4 });
      expect(four.games).toHaveLength(one.games.length);
      expect(one.games.length).toBeGreaterThan(4);
      expect(four.games.map(fingerprint)).toEqual(one.games.map(fingerprint));
    },
  );

  it(
    'reports progress once per game, whatever the thread count',
    { timeout: 600_000 },
    async () => {
      const seen: number[] = [];
      const result = await runBalance(data, {
        ...PLAN,
        workers: 4,
        onGame: (done) => seen.push(done),
      });
      // A count per game, and it only ever goes up: the pool counts completions,
      // never indices, so a progress line cannot go backwards when a later game
      // finishes first.
      expect(seen).toHaveLength(result.games.length);
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    },
  );
});
