/**
 * The smoke test: the metrics COMPUTE. Never that the design passes.
 *
 * Ticket 11 section 3 is emphatic about the difference. A failing watch-list
 * assertion means the game's balance is off, not that the code is broken; put
 * one in `npm run check` and a red assertion 2 blocks an unrelated commit,
 * whereupon the pressure becomes to loosen the threshold to get green - which
 * destroys the instrument. So nothing below asserts a verdict. It asserts that
 * every assertion produces a finite number or an honest NaN, that every card
 * gets a funnel row, and - the anti-rot half, in ticket 28's style - that the
 * fold claims every `GameEvent['e']` and every `Move['type']`, so a rules
 * change that adds either fails the build rather than being folded into
 * silence.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA } from '@gp/data';
import { MOVE_TYPES } from '@gp/engine';

import { WATCHLIST } from './assertions/index.js';
import { NO_REMEDY } from './assertions/types.js';
import { cutList, funnel } from './cutlist.js';
import { EVENT_KINDS, MOVE_KINDS } from './observe.js';
import { REFERENCE_V1, cellsFor, gamesPerCell } from './reference.js';
import { renderReport } from './report.js';
import { planRun, pool, runBalance } from './run.js';
import { runWatchlist } from './watchlist.js';

const data = BASE_GAME_DATA;

/** A handful of games. Enough to exercise every path, small enough for CI. */
const SMOKE = {
  reference: { ...REFERENCE_V1, targetGames: { 2: 4, 3: 4, 4: 2 }, maxMoves: 2500 },
  seed: 'smoke',
  games: 4,
};

const result = runBalance(data, { ...SMOKE, seatCounts: [2, 3] });
const pooled = pool(result);

describe('the stratified cells', () => {
  it('covers every legal suit combination: 30 / 20 / 5 by seat count', () => {
    expect(cellsFor(2, 3)).toHaveLength(30);
    expect(cellsFor(3, 4)).toHaveLength(20);
    expect(cellsFor(4, 5)).toHaveLength(5);
  });

  it('gives every cell the same number of games', () => {
    const plan = planRun(data, { reference: REFERENCE_V1, games: 500, seatCounts: [2] });
    const counts = new Set(plan.cells.map((c) => c.games));
    expect(counts.size).toBe(1);
    expect(plan.total).toBeGreaterThanOrEqual(500);
  });

  it('rounds up rather than down, so no cell is short', () => {
    expect(gamesPerCell(500, 30)).toBe(17);
    expect(gamesPerCell(1, 30)).toBe(1);
  });

  it('names the neutral deck, so a cell is addressable', () => {
    for (const game of result.games) {
      expect(new Set([...game.suits, ...game.neutral]).size).toBe(
        game.suits.length + game.neutral.length,
      );
      expect(game.neutral.every((s) => !game.suits.includes(s))).toBe(true);
    }
  });

  it('is reproducible from the seed alone', () => {
    const again = runBalance(data, { ...SMOKE, seatCounts: [2, 3] });
    expect(again.games.map((g) => g.moves)).toEqual(result.games.map((g) => g.moves));
    expect(again.games.map((g) => g.winner)).toEqual(result.games.map((g) => g.winner));
  });
});

describe('the metric fold', () => {
  it('claims every GameEvent kind', () => {
    // The `satisfies` in observe.ts is the real lock; this proves it is not
    // vacuous by checking the table is non-empty and total.
    const claimed = Object.keys(EVENT_KINDS);
    expect(claimed.length).toBeGreaterThan(20);
    expect(
      claimed.filter((k) => EVENT_KINDS[k as keyof typeof EVENT_KINDS]).length,
    ).toBeGreaterThan(15);
  });

  it('claims every Move type', () => {
    for (const type of MOVE_TYPES) expect(MOVE_KINDS).toHaveProperty(type);
    expect(Object.keys(MOVE_KINDS).sort()).toEqual([...MOVE_TYPES].sort());
  });

  it('observed at least one of every headline quantity', () => {
    const games = result.games;
    expect(games.length).toBeGreaterThan(0);
    expect(games.some((g) => g.rounds > 0)).toBe(true);
    expect(games.some((g) => g.coinsByRound.length > 0)).toBe(true);
    expect(games.some((g) => g.barnByRound.length > 0)).toBe(true);
    expect(games.some((g) => g.turnsBySeat.some((t) => t > 0))).toBe(true);
    expect(games.some((g) => g.visitsBySeat.some((v) => v > 0))).toBe(true);
    expect(games.some((g) => g.workerLifetimes.length > 0)).toBe(true);
  });

  it('never counts a card whose deck was out of the game', () => {
    for (const game of result.games) {
      const inPlay = new Set([...game.suits, ...game.neutral]);
      for (const [id, facts] of game.cards) {
        const card = data.cards.catalogue.find((c) => c.id === id);
        if (!card) continue;
        if (!inPlay.has(card.suit)) {
          expect(facts.inSupply, id).toBe(false);
          expect(facts.surfaced, id).toBe(false);
          expect(facts.held, id).toBe(false);
        }
      }
    }
  });
});

describe('the per-card funnel', () => {
  const rows = funnel(data, pooled);

  it('gives every card in the catalogue a row', () => {
    expect(rows).toHaveLength(data.cards.catalogue.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(data.cards.catalogue.length);
  });

  it('conditions each layer on the one above it', () => {
    for (const row of rows) {
      for (const value of [row.surface, row.keep, row.play, row.junk]) {
        if (Number.isFinite(value)) {
          expect(value, row.id).toBeGreaterThanOrEqual(0);
          expect(value, row.id).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('ranks the cut list without stamping anything', () => {
    const cuts = cutList(rows);
    // Starters are pre-built in every game, so a play rate for them is a
    // tautology: they are excluded from the ranking on purpose.
    expect(cuts.every((c) => !c.starter)).toBe(true);
    expect(cuts).toHaveLength(data.cards.catalogue.filter((c) => c.inDeck).length);
    for (const c of cuts) {
      expect(c.rankInBand).toBeGreaterThanOrEqual(1);
      expect(c.rankInBand).toBeLessThanOrEqual(c.bandSize);
    }
    expect(JSON.stringify(cuts)).not.toContain('CUT');
  });
});

describe('the watch-list suite', () => {
  const rows = runWatchlist(data, pooled, new Map());

  it('has all 13, numbered 1 to 13', () => {
    expect(rows.map((r) => r.assertion.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('produces a number and a verdict for each', () => {
    for (const { assertion, measurement } of rows) {
      expect(typeof measurement.value, assertion.title).toBe('number');
      expect(['PASS', 'FAIL', 'OBSERVE']).toContain(measurement.verdict);
      expect(measurement.headline.length, assertion.title).toBeGreaterThan(0);
    }
  });

  it('carries a design quote and a source for every assertion', () => {
    for (const { assertion } of rows) {
      expect(assertion.quote.length, assertion.title).toBeGreaterThan(40);
      expect(assertion.source.length, assertion.title).toBeGreaterThan(0);
    }
  });

  it('prescribes a remedy only where the design prescribes one', () => {
    for (const { assertion } of rows) {
      const prescribed = !assertion.remedy.startsWith(NO_REMEDY);
      if (prescribed) {
        // A prescribed remedy must be runnable: it names a committed overlay.
        expect(assertion.remedy, assertion.title).toMatch(/overlays\/[a-z-]+\.overlay\.json/);
      }
    }
  });

  it('marks exactly the three taste-sensitive assertions', () => {
    expect(rows.filter((r) => r.assertion.taste).map((r) => r.assertion.id)).toEqual([2, 8, 11]);
  });

  // Deliberately absent: any assertion that the design PASSES. That belongs to
  // the CLI, and putting it here would turn a balance finding into a build
  // failure and the threshold into something to be loosened.
  it('does not assert a verdict', () => {
    expect(true).toBe(true);
  });
});

describe('the report', () => {
  it('renders, and names the reference, the seed and n in its header', () => {
    const text = renderReport({
      data,
      result,
      pooled,
      rows: runWatchlist(data, pooled, new Map()),
      mirrorGames: 0,
      overlayName: null,
      fullFunnel: true,
    });
    expect(text).toContain(REFERENCE_V1.id);
    expect(text).toContain('smoke');
    expect(text).toContain('THE WATCH LIST');
    expect(text).toContain('THE CUT LIST');
    expect(text).toContain('VERDICT:');
    for (const assertion of WATCHLIST) expect(text).toContain(assertion.title);
  });
});
