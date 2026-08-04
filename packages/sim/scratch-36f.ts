/**
 * THROWAWAY - wayfinder ticket 36, part F. Delete when the ticket closes.
 *
 * Two facts that could reframe the whole ticket:
 *
 *  1. THE CONVERSION RATE. A harvest is one main action. How many cards does
 *     each KIND of building put in a barn for that action, and who paid for
 *     them? If the Notice Board is 5 cards for 1 action and every other harvest
 *     is 2-3 cards you paid for yourself, the defect is the host's conversion
 *     rate, not the visitor's payoff.
 *
 *  2. THE VP MIX BY SEAT COUNT. The design wants island deliveries at ~50% of a
 *     winning score. The reference run reads 70% pooled. If 2p is even higher,
 *     then the game IS a pure delivery race there, and anything feeding a
 *     rival's delivery decides it.
 */

import { BASE_GAME_DATA } from '@gp/data';
import type { Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const REF: WeightTable = {
  ...BALANCED,
  visit: 0,
  visitWorker: 0,
  visitSpecial: 0,
  visitFeeJunk: 0,
};

const data = BASE_GAME_DATA;
const slotOf = new Map(data.cards.catalogue.map((c) => [c.id, c.slot ?? null]));
const nameOf = new Map(data.cards.catalogue.map((c) => [c.id, c.name]));

interface Bucket {
  harvests: number;
  cards: number;
}
const byKind = new Map<string, Bucket>();
// Where did each card sitting on a building come from: the owner, or a visitor?
let placedByOwner = 0;
let placedByVisitor = 0;

const mix = new Map<number, { island: number; printed: number; endgame: number; n: number }>();

for (const seats of [2, 3, 4]) {
  mix.set(seats, { island: 0, printed: 0, endgame: 0, n: 0 });
  const cells = cellsFor(seats, data.island.decksInPlayBySeats[String(seats)] ?? seats + 1);
  for (const cell of cells) {
    const result = runGame(data, {
      seed: `t36f:${seats}:${cell.label}`,
      seats,
      suits: cell.suits as readonly Suit[],
      neutralSuits: cell.neutral as readonly Suit[],
      policies: Array.from({ length: seats }, () => scoredPolicy('ref', REF)),
      maxMoves: 6000,
      observe: (d) => {
        for (const e of d.events) {
          if (e.e === 'cardPlaced') {
            if (e.seat === e.onto.seat) placedByOwner += 1;
            else placedByVisitor += 1;
          }
          if (e.e === 'harvested') {
            const slot = slotOf.get(e.building) ?? null;
            const kind =
              slot === 'noticeboard'
                ? 'Notice Board'
                : slot
                  ? `starter: ${slot}`
                  : (nameOf.get(e.building) ? 'a built card' : 'unknown');
            const b = byKind.get(kind) ?? { harvests: 0, cards: 0 };
            b.harvests += 1;
            b.cards += e.cards.length;
            byKind.set(kind, b);
          }
        }
      },
    });
    if (!result.ended) continue;
    const s = score(data, result.state);
    const win = s.seats[s.ranking[0] as number];
    if (!win) continue;
    const m = mix.get(seats) as { island: number; printed: number; endgame: number; n: number };
    m.island += win.receipts;
    m.printed += win.printed;
    m.endgame += win.endgame;
    m.n += 1;
  }
}

console.log('\n=== 1. What one harvest action is worth, by building ===\n');
console.log('building            harvests   cards   cards per harvest');
for (const [kind, b] of [...byKind].sort((a, c) => c[1].cards - a[1].cards)) {
  console.log(
    `${kind.padEnd(20)} ${String(b.harvests).padStart(8)}  ${String(b.cards).padStart(6)}   ${(b.cards / b.harvests).toFixed(2).padStart(16)}`,
  );
}
const total = placedByOwner + placedByVisitor;
console.log(
  `\ncards placed on a building: ${((100 * placedByOwner) / total).toFixed(1)}% by the owner, ${((100 * placedByVisitor) / total).toFixed(1)}% by a visitor`,
);

console.log('\n=== 2. The winning score, by source and seat count ===\n');
console.log('seats  games   island   printed  endgame   (design wants island ~50%)');
for (const [seats, m] of mix) {
  const t = m.island + m.printed + m.endgame;
  console.log(
    `${String(seats).padStart(5)}  ${String(m.n).padStart(5)}   ${((100 * m.island) / t).toFixed(0).padStart(5)}%   ${((100 * m.printed) / t).toFixed(0).padStart(6)}%  ${((100 * m.endgame) / t).toFixed(0).padStart(6)}%`,
  );
}
