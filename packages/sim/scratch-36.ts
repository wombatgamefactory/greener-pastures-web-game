/**
 * THROWAWAY - wayfinder ticket 36. Delete when the ticket closes.
 *
 * Experiment 1: a controlled dose-response ladder on the visit weight.
 * Every variant is `balanced` with ONE thing changed, so any win-rate
 * difference is attributable. Duels at 2 seats: every pair, in every suit
 * cell, in both seat orders.
 */

import { BASE_GAME_DATA, SUITS } from '@gp/data';
import type { Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy, weightsFor } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const VARIANTS: Record<string, WeightTable> = {
  // The dose ladder: only the flat `visit` constant moves.
  'v-veto': { ...BALANCED, visit: -100, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0 },
  'v0': { ...BALANCED },
  'v1': { ...BALANCED, visit: 1 },
  'v2': { ...BALANCED, visit: 2 },
  'v4': { ...BALANCED, visit: 4 },
  'v8': { ...BALANCED, visit: 8 },
  // The two real profiles, and the hermit decomposed.
  'hermit': { ...weightsFor('hermit') },
  'socialite': { ...weightsFor('socialite') },
  'no-cardmove': { ...BALANCED, cardMove: -100 },
};

const NAMES = Object.keys(VARIANTS);

interface Tally {
  games: number;
  wins: number;
  score: number;
  visits: number;
  turns: number;
}

const tally = new Map<string, Tally>(
  NAMES.map((n) => [n, { games: 0, wins: 0, score: 0, visits: 0, turns: 0 }]),
);
const head = new Map<string, { a: number; b: number }>();

const data = BASE_GAME_DATA;
const cells = cellsFor(2, data.island.decksInPlayBySeats['2'] ?? 3);
let ended = 0;
let unfinished = 0;
const started = Date.now();

for (let i = 0; i < NAMES.length; i++) {
  for (let j = i + 1; j < NAMES.length; j++) {
    const a = NAMES[i] as string;
    const b = NAMES[j] as string;
    const key = `${a} vs ${b}`;
    head.set(key, { a: 0, b: 0 });
    for (const cell of cells) {
      for (const order of [0, 1]) {
        const names = order === 0 ? [a, b] : [b, a];
        const seed = `t36:${a}:${b}:${cell.label}:${order}`;
        const visits = [0, 0];
        const result = runGame(data, {
          seed,
          seats: 2,
          suits: cell.suits as readonly Suit[],
          neutralSuits: cell.neutral as readonly Suit[],
          policies: names.map((n) => scoredPolicy(n, VARIANTS[n] as WeightTable)),
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
          const t = tally.get(names[seat] as string) as Tally;
          t.games += 1;
          t.score += (s.seats[seat]?.total ?? 0);
          t.visits += visits[seat] ?? 0;
          t.turns += result.turns / 2;
          if (seat === winner) t.wins += 1;
        }
        const h = head.get(key) as { a: number; b: number };
        if (names[winner] === a) h.a += 1;
        else h.b += 1;
      }
    }
  }
}

function ci(wins: number, n: number): string {
  if (n === 0) return '-';
  const p = wins / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  return `${(100 * (p - 1.96 * se)).toFixed(1)} - ${(100 * (p + 1.96 * se)).toFixed(1)}`;
}

console.log(`\n2-seat duels, every pair x ${cells.length} suit cells x 2 orders`);
console.log(`${ended} ended, ${unfinished} unfinished, ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log('variant        games   win%    95% interval     mean VP  visits/turn');
for (const name of NAMES) {
  const t = tally.get(name) as Tally;
  console.log(
    `${name.padEnd(14)} ${String(t.games).padStart(5)}   ${((100 * t.wins) / t.games).toFixed(1).padStart(5)}   ${ci(t.wins, t.games).padStart(15)}   ${(t.score / t.games).toFixed(1).padStart(6)}   ${(t.visits / t.turns).toFixed(3).padStart(6)}`,
  );
}

console.log('\nHead to head (wins for the left name):');
for (const [key, h] of head) {
  const n = h.a + h.b;
  console.log(`  ${key.padEnd(28)} ${h.a}-${h.b}   ${n ? ((100 * h.a) / n).toFixed(1) : '-'}%`);
}
