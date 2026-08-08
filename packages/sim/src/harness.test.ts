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
import type { Cell } from './reference.js';
import { REFERENCE, cellsFor, gamesPerCell, seatingFor } from './reference.js';
import { renderReport } from './report.js';
import { planRun, pool, runBalance } from './run.js';
import { runWatchlist } from './watchlist.js';

const data = BASE_GAME_DATA;

/** A handful of games. Enough to exercise every path, small enough for CI. */
const SMOKE = {
  reference: { ...REFERENCE, targetGames: { 2: 4, 3: 4, 4: 2 }, maxMoves: 2500 },
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
    const plan = planRun(data, { reference: REFERENCE, games: 500, seatCounts: [2] });
    const counts = new Set(plan.cells.map((c) => c.games));
    expect(counts.size).toBe(1);
    expect(plan.total).toBeGreaterThanOrEqual(500);
  });

  it('rounds up rather than down, so no cell is short', () => {
    // 500 over 30 cells is 16.7, up to 17, up again to 18 so it divides by the
    // 2 seatings. 1 over 30 cells is 1 game, up to 2 for the same reason.
    expect(gamesPerCell(500, 30, 2)).toBe(18);
    expect(gamesPerCell(1, 30, 2)).toBe(2);
    expect(gamesPerCell(500, 20, 3)).toBe(27);
    expect(gamesPerCell(500, 5, 4)).toBe(100);
  });

  /**
   * reference-v9's whole correction, guarded. This is the test to read if
   * someone ever "tidies" the rotation away: with a fixed seating, seat index is
   * welded to canonical suit order, wheat sits in the start player's chair in
   * 100% of games and dairy in 0%, and every per-suit win rate silently becomes
   * a mixture of the suit and the chair. That was true for eight references and
   * it passed every other test in this file.
   */
  it('rotates the suits around the table, so no suit is welded to a chair', () => {
    const cell = cellsFor(3, 4)[0] as Cell;
    const seatings = [0, 1, 2, 3].map((i) => seatingFor(cell, i));
    // Each rotation is a permutation of the same set...
    for (const s of seatings) expect([...s].sort()).toEqual([...cell.suits].sort());
    // ...they are distinct over one full turn of the wheel...
    expect(new Set(seatings.slice(0, 3).map((s) => s.join(','))).size).toBe(3);
    // ...and it wraps, so a whole multiple of the seat count is exactly balanced.
    expect(seatings[3]).toEqual(seatings[0]);
    // Every suit reaches every chair.
    for (let seat = 0; seat < 3; seat++) {
      expect(new Set(seatings.slice(0, 3).map((s) => s[seat])).size).toBe(3);
    }
  });

  it('seats a real run evenly, every suit in every chair', () => {
    const counts = new Map<string, number[]>();
    for (const game of result.games) {
      if (game.seats !== 2) continue;
      game.suits.forEach((suit, seat) => {
        const row = counts.get(suit) ?? [0, 0];
        row[seat] = (row[seat] ?? 0) + 1;
        counts.set(suit, row);
      });
    }
    // Exactly balanced, not merely approximately: the rotation is deterministic
    // and `gamesPerCell` rounds to a whole multiple of the seat count for it.
    for (const [, row] of counts) expect(row[0]).toBe(row[1]);
  });

  it('names the neutral deck, so a cell is addressable', () => {
    for (const game of result.games) {
      expect(new Set([...game.suits, ...game.neutral]).size).toBe(
        game.suits.length + game.neutral.length,
      );
      expect(game.neutral.every((s) => !game.suits.includes(s))).toBe(true);
    }
  });

  // Timed out on the 5s default while ticket 51 was verifying an unrelated
  // change: it walks a whole smoke balance run a SECOND time, and at 5.8s it sits
  // just the wrong side of the line, so it flakes on the machine rather than on
  // the code. Given an explicit budget rather than a faster run, because a
  // cheaper sample is a weaker reproducibility claim.
  it('is reproducible from the seed alone', { timeout: 30_000 }, () => {
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
    expect(games.some((g) => g.serviceClogSampledBySeat.some((n) => n > 0))).toBe(true);
  });

  it('counts a reshuffle for every crop in play and none for a crop that is not', () => {
    // The C1 stat, tracked from 2026-08-09. Two things can rot it and this
    // catches both: the event being re-claimed as uninteresting (the counter
    // silently stops), and a crop out of the game acquiring a count (the
    // played/neutral split in the report stops meaning anything). It does NOT
    // assert a rate - four games per cell is far too few, and a rate here would
    // be a verdict, which this file does not do.
    for (const game of result.games) {
      const inPlay = new Set([...game.suits, ...game.neutral]);
      for (const crop of inPlay) expect(game.reshufflesByCrop, crop).toHaveProperty(crop);
      for (const crop of Object.keys(game.reshufflesByCrop)) {
        expect(inPlay.has(crop as never), crop).toBe(true);
        expect(game.reshufflesByCrop[crop]).toBeGreaterThanOrEqual(0);
      }
    }
    // A played crop's deck is 12 cards, so at least one game in any real run
    // must have cycled one. If this ever fails, the counter is not wired up.
    expect(result.games.some((g) => g.suits.some((s) => (g.reshufflesByCrop[s] ?? 0) > 0))).toBe(
      true,
    );
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

  it('has all 14, numbered 1 to 14', () => {
    expect(rows.map((r) => r.assertion.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
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

  it('marks exactly the four taste-sensitive assertions', () => {
    // 14 joined the set with ticket 56: the bonus-slot mix is precisely the
    // kind of number a single taste could produce alone (a hermit mirror
    // markets instead of visiting by construction).
    expect(rows.filter((r) => r.assertion.taste).map((r) => r.assertion.id)).toEqual([
      2, 8, 11, 14,
    ]);
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
    expect(text).toContain(REFERENCE.id);
    expect(text).toContain('smoke');
    expect(text).toContain('THE WATCH LIST');
    expect(text).toContain('THE CUT LIST');
    expect(text).toContain('VERDICT:');
    for (const assertion of WATCHLIST) expect(text).toContain(assertion.title);
  });
});
