/**
 * THROWAWAY - wayfinder ticket 36, part C. Delete when the ticket closes.
 *
 * Part A: the visit veto beats the reference table ~90-10 at 2 seats.
 * Part B: it is not the leftover flat constants (v0-clean = v0), and a table
 *         where nobody visits LOCKS 43% of the time.
 *
 * Part C asks the two questions that remain:
 *   1. THE MECHANISM. Per seat: visits made, fees received on the Notice
 *      Board, cards harvested into the barn, deliveries, VP. If the abstainer
 *      wins by eating the visitor's fees, it shows here.
 *   2. IS IT 2-PLAYER? One abstainer at a table of n-1 reference bots, at
 *      2 / 3 / 4 seats, against the 1/n baseline. A gift is worth less to each
 *      rival when there are more of them.
 */

import { BASE_GAME_DATA } from '@gp/data';
import type { Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const CLEAN = { visit: 0, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0 };
const VETO: WeightTable = { ...BALANCED, ...CLEAN, visit: -100 };
const REF: WeightTable = { ...BALANCED, ...CLEAN };

const data = BASE_GAME_DATA;

// ------------------------------------------------- 1. the mechanism, at 2p

interface Seat {
  visitsMade: number;
  feesReceived: number;
  intoBarn: number;
  deliveries: number;
  vp: number;
  islandVp: number;
  coins: number;
  n: number;
}

function blank(): Seat {
  return {
    visitsMade: 0,
    feesReceived: 0,
    intoBarn: 0,
    deliveries: 0,
    vp: 0,
    islandVp: 0,
    coins: 0,
    n: 0,
  };
}

const mech: Record<string, Seat> = { veto: blank(), ref: blank() };
const cells2 = cellsFor(2, data.island.decksInPlayBySeats['2'] ?? 3);
let vetoWins = 0;
let mechGames = 0;

for (const cell of cells2) {
  for (const order of [0, 1]) {
    const names = order === 0 ? ['veto', 'ref'] : ['ref', 'veto'];
    const per = [blank(), blank()];
    const result = runGame(data, {
      seed: `t36c:mech:${cell.label}:${order}`,
      seats: 2,
      suits: cell.suits as readonly Suit[],
      neutralSuits: cell.neutral as readonly Suit[],
      policies: names.map((n) => scoredPolicy(n, n === 'veto' ? VETO : REF)),
      maxMoves: 6000,
      observe: (d) => {
        for (const e of d.events) {
          if (e.e === 'visited') (per[e.seat] as Seat).visitsMade += 1;
          // A fee landing on a Notice Board: the placement's target owner is the host.
          if (e.e === 'cardPlaced' && d.move.type === 'visit') {
            (per[e.onto.seat] as Seat).feesReceived += 1;
          }
          if (e.e === 'harvested') (per[e.seat] as Seat).intoBarn += e.cards.length;
          if (e.e === 'delivered') (per[e.seat] as Seat).deliveries += 1;
        }
      },
    });
    if (!result.ended) continue;
    mechGames += 1;
    const s = score(data, result.state);
    for (let seat = 0; seat < 2; seat++) {
      const t = mech[names[seat] as string] as Seat;
      const p = per[seat] as Seat;
      t.visitsMade += p.visitsMade;
      t.feesReceived += p.feesReceived;
      t.intoBarn += p.intoBarn;
      t.deliveries += p.deliveries;
      t.vp += s.seats[seat]?.total ?? 0;
      t.islandVp += s.seats[seat]?.receipts ?? 0;
      t.coins += result.state.players[seat]?.coins ?? 0;
      t.n += 1;
    }
    if (names[s.ranking[0] as number] === 'veto') vetoWins += 1;
  }
}

console.log(`\n=== 1. The mechanism, 2 seats, ${mechGames} ended games ===`);
console.log(`   the abstainer won ${((100 * vetoWins) / mechGames).toFixed(1)}%\n`);
console.log(
  'seat     visits made  fees received  cards to barn  deliveries  island VP  total VP  coins',
);
for (const [name, t] of Object.entries(mech)) {
  console.log(
    `${name.padEnd(8)} ${(t.visitsMade / t.n).toFixed(1).padStart(11)}  ${(t.feesReceived / t.n).toFixed(1).padStart(13)}  ${(t.intoBarn / t.n).toFixed(1).padStart(13)}  ${(t.deliveries / t.n).toFixed(2).padStart(10)}  ${(t.islandVp / t.n).toFixed(1).padStart(9)}  ${(t.vp / t.n).toFixed(1).padStart(8)}  ${(t.coins / t.n).toFixed(1).padStart(5)}`,
  );
}

// ------------------------------------------------- 2. does it scale with seats?

console.log('\n=== 2. One abstainer at a table of reference bots ===\n');
console.log('seats  games  ended  abstainer win%   baseline   mean VP (abstainer / field)');
for (const seats of [2, 3, 4]) {
  const cells = cellsFor(seats, data.island.decksInPlayBySeats[String(seats)] ?? seats + 1);
  let games = 0;
  let done = 0;
  let wins = 0;
  let vetoVp = 0;
  let fieldVp = 0;
  let fieldN = 0;
  for (const cell of cells) {
    for (let spot = 0; spot < seats; spot++) {
      games += 1;
      const result = runGame(data, {
        seed: `t36c:scale:${seats}:${cell.label}:${spot}`,
        seats,
        suits: cell.suits as readonly Suit[],
        neutralSuits: cell.neutral as readonly Suit[],
        policies: Array.from({ length: seats }, (_, i) =>
          scoredPolicy(i === spot ? 'veto' : 'ref', i === spot ? VETO : REF),
        ),
        maxMoves: 6000,
      });
      if (!result.ended) continue;
      done += 1;
      const s = score(data, result.state);
      if ((s.ranking[0] as number) === spot) wins += 1;
      for (let seat = 0; seat < seats; seat++) {
        const vp = s.seats[seat]?.total ?? 0;
        if (seat === spot) vetoVp += vp;
        else {
          fieldVp += vp;
          fieldN += 1;
        }
      }
    }
  }
  const p = wins / done;
  const se = Math.sqrt((p * (1 - p)) / done);
  console.log(
    `${String(seats).padStart(5)}  ${String(games).padStart(5)}  ${String(done).padStart(5)}  ${(100 * p).toFixed(1).padStart(9)} +-${(100 * 1.96 * se).toFixed(1).padStart(4)}   ${(100 / seats).toFixed(1).padStart(7)}%   ${(vetoVp / done).toFixed(1)} / ${(fieldVp / fieldN).toFixed(1)}`,
  );
}
