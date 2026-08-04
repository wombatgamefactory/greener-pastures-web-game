/**
 * THROWAWAY - wayfinder ticket 36, part B. Delete when the ticket closes.
 *
 * Part A found the visit veto worth ~90-10 head to head against the reference
 * table. Two things could produce that and they need separating:
 *
 *   1. The instrument. Ticket 40 took the flat `visit` constant to 0 but left
 *      `visitWorker: 2` and `visitSpecial: 1.5` standing - the same kind of
 *      fictional bonus, on the two payoffs that matter. `v0-clean` removes all
 *      three, so a visit is worth its probed payoff and nothing else.
 *   2. Free riding. A hermit in a mixed table receives visit fees and pays
 *      none, and 88.8% of everything reaching a barn arrives via a Notice Board
 *      harvest. The MIRROR is the control: if a table of hermits produces a
 *      stunted game, abstaining is parasitic rather than strong.
 */

import { BASE_GAME_DATA } from '@gp/data';
import type { Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy, weightsFor } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const CLEAN = { visit: 0, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0 };

const VARIANTS: Record<string, WeightTable> = {
  'v-veto': { ...BALANCED, visit: -100, ...CLEAN, visit_: 0 } as unknown as WeightTable,
  'v0': { ...BALANCED },
  'v0-clean': { ...BALANCED, ...CLEAN },
  'v-1-clean': { ...BALANCED, ...CLEAN, visit: -1 },
  'v-3-clean': { ...BALANCED, ...CLEAN, visit: -3 },
  'socialite': { ...weightsFor('socialite') },
};
// v-veto is just "never visit"; rebuild it cleanly.
VARIANTS['v-veto'] = { ...BALANCED, ...CLEAN, visit: -100 };

const data = BASE_GAME_DATA;

// ---------------------------------------------------------------- duels

interface Tally {
  games: number;
  wins: number;
  score: number;
  visits: number;
  turns: number;
}

function duels(names: string[], seats: number): void {
  const tally = new Map<string, Tally>(
    names.map((n) => [n, { games: 0, wins: 0, score: 0, visits: 0, turns: 0 }]),
  );
  const head = new Map<string, { a: number; b: number }>();
  const cells = cellsFor(2, data.island.decksInPlayBySeats['2'] ?? 3);
  let ended = 0;
  let unfinished = 0;

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i] as string;
      const b = names[j] as string;
      const key = `${a} vs ${b}`;
      head.set(key, { a: 0, b: 0 });
      for (const cell of cells) {
        for (const order of [0, 1]) {
          const seated = order === 0 ? [a, b] : [b, a];
          const visits = [0, 0];
          const result = runGame(data, {
            seed: `t36b:${a}:${b}:${cell.label}:${order}`,
            seats,
            suits: cell.suits as readonly Suit[],
            neutralSuits: cell.neutral as readonly Suit[],
            policies: seated.map((n) => scoredPolicy(n, VARIANTS[n] as WeightTable)),
            maxMoves: 6000,
            observe: (d) => {
              if (d.move.type === 'visit') visits[d.seat] = (visits[d.seat] ?? 0) + 1;
            },
          });
          if (!result.ended) {
            unfinished += 1;
            continue;
          }
          ended += 1;
          const s = score(data, result.state);
          const winner = s.ranking[0] as number;
          for (let seat = 0; seat < 2; seat++) {
            const t = tally.get(seated[seat] as string) as Tally;
            t.games += 1;
            t.score += s.seats[seat]?.total ?? 0;
            t.visits += visits[seat] ?? 0;
            t.turns += result.turns / 2;
            if (seat === winner) t.wins += 1;
          }
          const h = head.get(key) as { a: number; b: number };
          if (seated[winner] === a) h.a += 1;
          else h.b += 1;
        }
      }
    }
  }

  console.log(`\n=== 2-seat duels: ${ended} ended, ${unfinished} unfinished ===\n`);
  console.log('variant        games   win%    95% interval     mean VP  visits/turn');
  for (const name of names) {
    const t = tally.get(name) as Tally;
    const p = t.wins / t.games;
    const se = Math.sqrt((p * (1 - p)) / t.games);
    console.log(
      `${name.padEnd(14)} ${String(t.games).padStart(5)}   ${(100 * p).toFixed(1).padStart(5)}   ${`${(100 * (p - 1.96 * se)).toFixed(1)} - ${(100 * (p + 1.96 * se)).toFixed(1)}`.padStart(15)}   ${(t.score / t.games).toFixed(1).padStart(6)}   ${(t.visits / t.turns).toFixed(3).padStart(6)}`,
    );
  }
  console.log('\nHead to head (wins for the left name):');
  for (const [key, h] of head) {
    const n = h.a + h.b;
    console.log(`  ${key.padEnd(26)} ${h.a}-${h.b}   ${n ? ((100 * h.a) / n).toFixed(1) : '-'}%`);
  }
}

// ---------------------------------------------------------------- mirrors

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function mirrors(names: string[], seatCounts: number[]): void {
  console.log('\n=== Mirrors: every seat the same variant ===\n');
  console.log(
    'variant        seats  games  ended%  lock%  winner VP  table VP  island  rounds  visits/turn  end coins',
  );
  for (const name of names) {
    for (const seats of seatCounts) {
      const cells = cellsFor(seats, data.island.decksInPlayBySeats[String(seats)] ?? seats + 1);
      const winnerVp: number[] = [];
      const tableVp: number[] = [];
      const fills: number[] = [];
      const rounds: number[] = [];
      const coins: number[] = [];
      let games = 0;
      let done = 0;
      let locked = 0;
      let visits = 0;
      let turns = 0;
      for (const cell of cells) {
        games += 1;
        const result = runGame(data, {
          seed: `t36b:mirror:${name}:${cell.label}`,
          seats,
          suits: cell.suits as readonly Suit[],
          neutralSuits: cell.neutral as readonly Suit[],
          policies: Array.from(
            { length: seats },
            () => scoredPolicy(name, VARIANTS[name] as WeightTable),
          ),
          maxMoves: 6000,
          observe: (d) => {
            if (d.move.type === 'visit') visits += 1;
          },
        });
        turns += result.turns;
        if (result.outcome === 'stalled') locked += 1;
        if (!result.ended) continue;
        done += 1;
        const s = score(data, result.state);
        winnerVp.push(s.seats[s.ranking[0] as number]?.total ?? 0);
        for (const seat of s.seats) tableVp.push(seat.total);
        const capacity = result.state.island.tiles.length * data.island.deliveriesPerTile;
        const made = result.state.island.tiles.reduce((n, t) => n + t.deliveredBy.length, 0);
        fills.push(made / capacity);
        rounds.push(result.turns / seats);
        for (const p of result.state.players) coins.push(p.coins);
      }
      console.log(
        `${name.padEnd(14)} ${String(seats).padStart(5)}  ${String(games).padStart(5)}  ${((100 * done) / games).toFixed(0).padStart(6)}  ${((100 * locked) / games).toFixed(0).padStart(5)}  ${median(winnerVp).toFixed(0).padStart(9)}  ${median(tableVp).toFixed(0).padStart(8)}  ${(100 * median(fills)).toFixed(0).padStart(5)}%  ${median(rounds).toFixed(0).padStart(6)}  ${(visits / turns).toFixed(3).padStart(11)}  ${median(coins).toFixed(0).padStart(9)}`,
      );
    }
  }
}

const started = Date.now();
duels(['v-veto', 'v0', 'v0-clean', 'v-1-clean', 'v-3-clean', 'socialite'], 2);
mirrors(['v-veto', 'v0', 'v0-clean', 'socialite'], [2, 3]);
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
