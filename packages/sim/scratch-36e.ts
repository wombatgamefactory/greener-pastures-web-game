/**
 * THROWAWAY - wayfinder ticket 36, part E. Delete when the ticket closes.
 *
 * Which BRANCH of the visit is the losing one? On the worker branch the bank
 * mints the host a wage; on the coin branch the host gains nothing at all but
 * the card. So the coin branch is a pure transfer of a delivery good for £1.
 *
 * Four bots, identical but for which visits they will take, all duelled against
 * each other at 2 seats across every suit cell in both orders.
 */

import { BASE_GAME_DATA } from '@gp/data';
import type { Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const CLEAN = { visit: 0, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0 };

const VARIANTS: Record<string, WeightTable> = {
  'never': { ...BALANCED, ...CLEAN, visit: -100 },
  'worker-only': { ...BALANCED, ...CLEAN, visit: -100, visitWorker: 100, visitSpecial: 100 },
  'coin-only': { ...BALANCED, ...CLEAN, visitWorker: -100, visitSpecial: -100 },
  'both': { ...BALANCED, ...CLEAN },
};

const NAMES = Object.keys(VARIANTS);
const data = BASE_GAME_DATA;
const cells = cellsFor(2, data.island.decksInPlayBySeats['2'] ?? 3);

interface T {
  games: number;
  wins: number;
  vp: number;
  coinV: number;
  workerV: number;
  turns: number;
}
const tally = new Map<string, T>(
  NAMES.map((n) => [n, { games: 0, wins: 0, vp: 0, coinV: 0, workerV: 0, turns: 0 }]),
);
const head = new Map<string, { a: number; b: number }>();

for (let i = 0; i < NAMES.length; i++) {
  for (let j = i + 1; j < NAMES.length; j++) {
    const a = NAMES[i] as string;
    const b = NAMES[j] as string;
    head.set(`${a} vs ${b}`, { a: 0, b: 0 });
    for (const cell of cells) {
      for (const order of [0, 1]) {
        const seated = order === 0 ? [a, b] : [b, a];
        const coinV = [0, 0];
        const workerV = [0, 0];
        const result = runGame(data, {
          seed: `t36e:${a}:${b}:${cell.label}:${order}`,
          seats: 2,
          suits: cell.suits as readonly Suit[],
          neutralSuits: cell.neutral as readonly Suit[],
          policies: seated.map((n) => scoredPolicy(n, VARIANTS[n] as WeightTable)),
          maxMoves: 6000,
          observe: (d) => {
            for (const e of d.events) {
              if (e.e !== 'visited') continue;
              if (e.mode === 'worker') workerV[e.seat] = (workerV[e.seat] ?? 0) + 1;
              else coinV[e.seat] = (coinV[e.seat] ?? 0) + 1;
            }
          },
        });
        if (!result.ended) continue;
        const s = score(data, result.state);
        const winner = s.ranking[0] as number;
        for (let seat = 0; seat < 2; seat++) {
          const t = tally.get(seated[seat] as string) as T;
          t.games += 1;
          t.vp += s.seats[seat]?.total ?? 0;
          t.coinV += coinV[seat] ?? 0;
          t.workerV += workerV[seat] ?? 0;
          t.turns += result.turns / 2;
          if (seat === winner) t.wins += 1;
        }
        const h = head.get(`${a} vs ${b}`) as { a: number; b: number };
        if (seated[winner] === a) h.a += 1;
        else h.b += 1;
      }
    }
  }
}

console.log('\nWhich branch of the visit loses? 2-seat duels, every pair\n');
console.log('variant       games   win%    95% interval    mean VP   coin visits  worker visits');
for (const n of NAMES) {
  const t = tally.get(n) as T;
  const p = t.wins / t.games;
  const se = Math.sqrt((p * (1 - p)) / t.games);
  console.log(
    `${n.padEnd(13)} ${String(t.games).padStart(5)}   ${(100 * p).toFixed(1).padStart(5)}   ${`${(100 * (p - 1.96 * se)).toFixed(1)} - ${(100 * (p + 1.96 * se)).toFixed(1)}`.padStart(14)}   ${(t.vp / t.games).toFixed(1).padStart(6)}   ${(t.coinV / t.games).toFixed(1).padStart(11)}   ${(t.workerV / t.games).toFixed(1).padStart(12)}`,
  );
}
console.log('\nHead to head (wins for the left name):');
for (const [key, h] of head) {
  const n = h.a + h.b;
  console.log(`  ${key.padEnd(28)} ${h.a}-${h.b}   ${n ? ((100 * h.a) / n).toFixed(1) : '-'}%`);
}
