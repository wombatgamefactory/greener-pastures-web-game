/**
 * The runner: walk the stratified cells, fold every decision, pool the result.
 *
 * Single-core on purpose. Ticket 11 closed the throughput question by
 * arithmetic rather than engineering - ticket 28 measured a mixed scored table
 * at 27 / 17 / 12 games per second, so a full run at n=500 per seat count is
 * about 90 seconds. No worker threads, no structural sharing. Parallelism
 * returns only if a sweep actually hurts.
 *
 * The one thing worth knowing about the pooling: ticket 11 section 7 excludes
 * STALLED games from balance means, because they end with the whole card supply
 * nailed into buildings and barns. That exclusion is survivorship bias landing
 * squarely on two of the assertions, so the four bias-exposed series - end
 * coins, the barn series, game length and deliveries per seat - are ALSO
 * computed over all games and carried as a second column. The size of the bias
 * is printed, never assumed small.
 */

import type { GameData, Suit } from '@gp/data';
import { SUITS } from '@gp/data';
import { makeCapture } from '@gp/engine';
import type { Capture } from '@gp/engine';
import type { PolicyId } from '@gp/bots';

import { assignProfiles, runGame } from './driver.js';
import { Fold } from './observe.js';
import type { CardFacts, GameMetrics } from './observe.js';
import type { Cell, ReferenceConfig } from './reference.js';
import { cellsFor, gamesPerCell } from './reference.js';

export interface RunOptions {
  readonly reference: ReferenceConfig;
  readonly seed?: string | undefined;
  /** Override the per-seat-count target. Used by the smoke test and by --n. */
  readonly games?: number | undefined;
  readonly seatCounts?: readonly number[] | undefined;
  /** Called after each game, for a progress line on a 90-second run. */
  readonly onGame?: ((done: number, total: number) => void) | undefined;
  /**
   * Called with a ready-made capture for every game the engine threw in
   * (ticket 31). The run itself does no I/O - the caller writes the file - but
   * building the envelope belongs here, because this is where the seed, the
   * cell's suits and the seat profiles are all in scope at once.
   *
   * Ticket 30's bug killed a 1510-game run at game 751 and had to be re-found
   * by hand afterwards. With this it is a file on disk the moment it happens,
   * and `--replay` turns it into a fixture.
   */
  readonly onCrash?: ((capture: Capture) => void) | undefined;
  /** Names the overlay in a crash capture. Metadata only. */
  readonly overlay?: string | null | undefined;
}

export interface RunPlan {
  readonly cells: readonly { cell: Cell; games: number }[];
  readonly total: number;
}

export function planRun(data: GameData, opts: RunOptions): RunPlan {
  const seatCounts = opts.seatCounts ?? opts.reference.seatCounts;
  const cells: { cell: Cell; games: number }[] = [];
  for (const seats of seatCounts) {
    const decks = data.island.decksInPlayBySeats[String(seats)] ?? seats + 1;
    const all = cellsFor(seats, decks);
    const target = opts.games ?? opts.reference.targetGames[seats] ?? 100;
    const per = gamesPerCell(target, all.length);
    for (const cell of all) cells.push({ cell, games: per });
  }
  return { cells, total: cells.reduce((n, c) => n + c.games, 0) };
}

export interface RunResult {
  readonly reference: ReferenceConfig;
  readonly seed: string;
  readonly data: GameData;
  readonly games: readonly GameMetrics[];
  readonly plan: RunPlan;
  readonly wallMs: number;
}

export function runBalance(data: GameData, opts: RunOptions): RunResult {
  const seed = opts.seed ?? opts.reference.seed;
  const plan = planRun(data, opts);
  const games: GameMetrics[] = [];
  const started = Date.now();

  for (const { cell, games: n } of plan.cells) {
    for (let i = 0; i < n; i++) {
      const gameSeed = `${seed}:${cell.seats}:${cell.label}:${i}`;
      const profiles = assignProfiles(gameSeed, cell.seats, opts.reference.pool);
      const fold = new Fold(
        data,
        {
          seed: gameSeed,
          cell: cell.label,
          suits: cell.suits,
          neutral: cell.neutral,
          profiles,
        },
        cell.seats,
      );
      const result = runGame(data, {
        seed: gameSeed,
        seats: cell.seats,
        suits: cell.suits,
        neutralSuits: cell.neutral,
        policies: profiles,
        maxMoves: opts.reference.maxMoves,
        observe: (d) => fold.observe(d),
      });
      games.push(fold.finish(result.state, result.outcome, result.chooseMs, result.error ?? null));
      if (result.outcome === 'crashed' && opts.onCrash) {
        opts.onCrash(
          makeCapture({
            label: 'bug',
            // The note is the run's own account of itself. A simulator capture
            // has no human behind it, so this is what a reader gets instead.
            note:
              `Emitted automatically by a balance run.\n` +
              `Cell ${cell.label} at ${cell.seats} seats, game ${i} of ${n}.`,
            at: new Date().toISOString(),
            origin: 'sim',
            dataFingerprint: result.state.dataFingerprint,
            setup: {
              seed: gameSeed,
              seats: cell.seats,
              suits: cell.suits,
              neutralSuits: cell.neutral,
            },
            policies: profiles,
            // The attempted move is appended so the replay throws in the same
            // place rather than reaching the crash position and stopping
            // cleanly. It is absent when the throw came from `legalMoves`, and
            // then the log alone reaches the position that cannot enumerate.
            moves: result.attempted ? [...result.moves, result.attempted] : result.moves,
            seat: result.state.turnPlayer,
            turn: result.turns,
            overlay: opts.overlay ?? null,
            error: result.error ?? null,
          }),
        );
      }
      opts.onGame?.(games.length, plan.total);
    }
  }

  return { reference: opts.reference, seed, data, games, plan, wallMs: Date.now() - started };
}

// --- Pooling ---------------------------------------------------------------

export interface SeatCountSlice {
  readonly seats: number;
  readonly all: readonly GameMetrics[];
  readonly ended: readonly GameMetrics[];
  readonly stallRate: number;
}

export interface CardTotals {
  readonly id: string;
  /** Games in which this card's deck was on the table. */
  inSupply: number;
  surfaced: number;
  held: number;
  kept: number;
  played: number;
  junked: number;
  activations: number;
  vp: number;
  coins: number;
  /** Seat-games where the seat built this card, and how many of those it won. */
  builtSeats: number;
  builtWins: number;
  unbuiltSeats: number;
  unbuiltWins: number;
}

export interface Pooled {
  readonly bySeats: readonly SeatCountSlice[];
  readonly all: readonly GameMetrics[];
  readonly ended: readonly GameMetrics[];
  readonly cards: ReadonlyMap<string, CardTotals>;
  /** Win counts by the seat's own suit, over ended games. */
  readonly winsBySuit: ReadonlyMap<Suit, { seats: number; wins: number }>;
  /** Win counts by the seat's bot profile, over ended games. */
  readonly winsByProfile: ReadonlyMap<PolicyId, { seats: number; wins: number }>;
}

export function pool(result: RunResult): Pooled {
  const seatCounts = [...new Set(result.games.map((g) => g.seats))].sort((a, b) => a - b);
  const bySeats = seatCounts.map((seats) => {
    const all = result.games.filter((g) => g.seats === seats);
    const ended = all.filter((g) => g.ended);
    return { seats, all, ended, stallRate: all.length === 0 ? NaN : 1 - ended.length / all.length };
  });

  const cards = new Map<string, CardTotals>();
  for (const card of result.data.cards.catalogue) {
    cards.set(card.id, {
      id: card.id,
      inSupply: 0,
      surfaced: 0,
      held: 0,
      kept: 0,
      played: 0,
      junked: 0,
      activations: 0,
      vp: 0,
      coins: 0,
      builtSeats: 0,
      builtWins: 0,
      unbuiltSeats: 0,
      unbuiltWins: 0,
    });
  }

  const winsBySuit = new Map<Suit, { seats: number; wins: number }>();
  const winsByProfile = new Map<PolicyId, { seats: number; wins: number }>();
  for (const suit of SUITS) winsBySuit.set(suit, { seats: 0, wins: 0 });

  const ended = result.games.filter((g) => g.ended);
  for (const game of ended) {
    game.suits.forEach((suit, seat) => {
      const s = winsBySuit.get(suit);
      if (s) {
        s.seats += 1;
        if (game.winner === seat) s.wins += 1;
      }
      const profile = game.profiles[seat];
      if (profile) {
        const p = winsByProfile.get(profile) ?? { seats: 0, wins: 0 };
        p.seats += 1;
        if (game.winner === seat) p.wins += 1;
        winsByProfile.set(profile, p);
      }
    });

    for (const [id, facts] of game.cards) {
      const t = cards.get(id);
      if (!t) continue;
      foldCard(t, facts, game);
    }
  }

  return { bySeats, all: result.games, ended, cards, winsBySuit, winsByProfile };
}

function foldCard(t: CardTotals, f: CardFacts, game: GameMetrics): void {
  if (!f.inSupply) return;
  t.inSupply += 1;
  if (f.surfaced) t.surfaced += 1;
  if (f.held) t.held += 1;
  if (f.kept) t.kept += 1;
  if (f.played) t.played += 1;
  if (f.junked) t.junked += 1;
  t.activations += f.activations;
  t.vp += f.vp.reduce((a, b) => a + b, 0);
  t.coins += f.coins.reduce((a, b) => a + b, 0);
  for (let seat = 0; seat < game.seats; seat++) {
    const won = game.winner === seat ? 1 : 0;
    if (f.builtBy.includes(seat)) {
      t.builtSeats += 1;
      t.builtWins += won;
    } else {
      t.unbuiltSeats += 1;
      t.unbuiltWins += won;
    }
  }
}
