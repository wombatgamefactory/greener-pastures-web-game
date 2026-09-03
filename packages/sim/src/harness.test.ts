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

import { RETIRED, WATCHLIST } from './assertions/index.js';
import { NO_REMEDY } from './assertions/types.js';
import { cutList, funnel } from './cutlist.js';
import { EVENT_KINDS, MOVE_KINDS } from './observe.js';
import type { Cell } from './reference.js';
import { REFERENCE, cellsFor, gamesPerCell, seatingFor } from './reference.js';
import { renderReport } from './report.js';
import { planRun, pool, runBalance } from './run.js';
import { runWatchlist } from './watchlist.js';

const data = BASE_GAME_DATA;

/**
 * A handful of games. Enough to exercise every path, small enough for CI.
 *
 * ⛔ **IT IS NO LONGER SMALL ENOUGH FOR CI, AND THAT IS NOT A TEST PROBLEM.**
 * Measured 02/09/2026: a 2-seat v31 game costs two to seven MINUTES against
 * reference-v9's 0.1 seconds, because deleting the hand limit deleted the bound
 * `subsets` in the engine's `actions.ts` was written against - hands reach 34
 * cards and one position enumerated 43,879 legal moves, 43,845 of them build
 * payments. This constant walks 120 games and then walks them again for the
 * reproducibility check, so the file cannot finish.
 *
 * It has deliberately NOT been shrunk to get green. Shrinking it would hide the
 * one finding that blocks everything else, and the smoke test's whole job is to
 * prove the fold covers every path - which a truncated game does not do, since
 * `delivered`, `meepleGained`, `endTriggered` and `gameEnded` all live in the
 * back half. Fix the branching factor upstream and this comment goes with it.
 */
const SMOKE = {
  reference: { ...REFERENCE, targetGames: { 2: 4, 3: 4, 4: 2 }, maxMoves: 2500 },
  seed: 'smoke',
  games: 4,
};

// Top-level await: `runBalance` spreads its plan over worker threads since
// 03/09/2026, so the whole file waits on one real run exactly as it did when
// the run was synchronous.
const result = await runBalance(data, { ...SMOKE, seatCounts: [2, 3] });
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
  //
  // ⚠️ 30s -> 600s ON 03/09/2026, and it is the game that grew rather than the
  // machine that slowed. A v31 game runs about 45 rounds at two seats where a
  // v30 one ran far fewer, so the 120-game smoke run is minutes rather than
  // seconds and this test pays for it twice. Same reasoning as before: the
  // sample is the claim, so the budget moves and the sample does not.
  it('is reproducible from the seed alone', { timeout: 600_000 }, async () => {
    const again = await runBalance(data, { ...SMOKE, seatCounts: [2, 3] });
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
    expect(games.some((g) => g.meeplesByRound.length > 0)).toBe(true);
    expect(games.some((g) => g.barnByRound.length > 0)).toBe(true);
    expect(games.some((g) => g.turnsBySeat.some((t) => t > 0))).toBe(true);
    expect(games.some((g) => g.visitsBySeat.some((v) => v > 0))).toBe(true);
    expect(games.some((g) => g.doorClogSampledBySeat.some((n: number) => n > 0))).toBe(true);
    // The three v31 quantities, each the subject of a new assertion. A zero
    // across a whole smoke run means the fold never saw the mechanism at all,
    // which is a different failure from a bad number and worth catching here.
    expect(games.some((g) => g.actionsBySeat.some((n) => n > 0))).toBe(true);
    expect(games.some((g) => g.meeplesGainedBySeat.some((n) => n > 0))).toBe(true);
    expect(games.some((g) => Object.values(g.doorUsesByColour).some((n) => n > 0))).toBe(true);
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

  /**
   * ⭐ THIRTEEN, AND THE GAPS ARE THE POINT (v31, 02/09/2026). It used to read
   * "all 14, numbered 1 to 14", which was true while the suite had never buried
   * anything. Four assertions were retired when v31 deleted the currency their
   * subject was denominated in - 1 coin-flood, 3 bootstrap, 10 bread-hall, 14
   * market-mix - and three were written: 15 meeple economy, 16 action
   * inflation, 17 bonus mix.
   *
   * **IDS ARE NEVER REUSED**, which is what the second half of this test
   * guards. A retired id that came back on a different question would silently
   * re-point every archived report that mentions it, so each gap must be
   * claimed by a tombstone and no tombstone may collide with a live assertion.
   */
  it('is numbered without reuse, and every gap has a tombstone', () => {
    const live = rows.map((r) => r.assertion.id);
    expect(live).toEqual([2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17]);
    expect(new Set(live).size, 'a duplicate id').toBe(live.length);

    const buried = RETIRED.map((t) => t.id);
    expect(buried).toEqual([1, 3, 10, 14]);
    for (const id of buried) expect(live, `id ${id} was reused`).not.toContain(id);

    // Every number from 1 to the highest live id is claimed by exactly one of
    // the two lists, so an id cannot be quietly dropped either.
    const highest = Math.max(...live);
    for (let id = 1; id <= highest; id++) {
      const claims = (live.includes(id) ? 1 : 0) + (buried.includes(id) ? 1 : 0);
      expect(claims, `id ${id} is claimed ${claims} times`).toBe(1);
    }
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
        // ⚠️ The character class gained digits on 03/09/2026: the v31 overlays
        // carry them (`end-trigger-8`, `orchard-door-draw-two-v1`) and the old
        // `[a-z-]+` silently refused every one of them, so a perfectly runnable
        // remedy failed this test.
        expect(assertion.remedy, assertion.title).toMatch(
          /overlays\/[a-z0-9-]+\.(overlay|sweep)\.json/,
        );
      }
    }
  });

  it('marks exactly the six taste-sensitive assertions', () => {
    // Taste-sensitive means "one archetype could produce this number on its
    // own", and the mirrors re-measure it. It was four; v31 makes it six, and
    // all three new assertions are on the list for the same reason: a hermit
    // never visits, so it spends its bonus slot on Draw 1 by construction (17),
    // which changes what it does with its meeples (15) and how many actions it
    // resolves a turn (16). 14 left the set with the market.
    expect(rows.filter((r) => r.assertion.taste).map((r) => r.assertion.id)).toEqual([
      2, 8, 11, 15, 16, 17,
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
