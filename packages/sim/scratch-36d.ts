/**
 * THROWAWAY - wayfinder ticket 36, part D. Delete when the ticket closes.
 *
 * Part C proved the mechanism: at 2 seats the abstainer's barn is filled by its
 * opponent's visit fees (26.4 cards to barn against 7.8, 6.5 deliveries against
 * 1.5). Part D probes three candidate remedies against the same duel, so the
 * grilling can hand Dean tested dials rather than guesses.
 *
 *   base           the live rules, for reference
 *   pay3           visitPayout 1/2/3 -> 3/4/5. Pay the visitor more coin.
 *   no-free-work   both bots lose the free own-Worker use (a bot-level stand-in
 *                  for deleting that bullet from the bonus slot).
 *   board-4        the Notice Board clogs at 4 rather than 5, at every seat count.
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import type { GameData, Overlay, Suit } from '@gp/data';
import { score } from '@gp/engine';
import { BALANCED, scoredPolicy } from '@gp/bots';
import type { WeightTable } from '@gp/bots';

import { runGame } from './src/driver.js';
import { cellsFor } from './src/reference.js';

const CLEAN = { visit: 0, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0 };
const VETO: WeightTable = { ...BALANCED, ...CLEAN, visit: -100 };
const REF: WeightTable = { ...BALANCED, ...CLEAN };
const VETO_NW: WeightTable = { ...VETO, workOwn: -100 };
const REF_NW: WeightTable = { ...REF, workOwn: -100 };

// The Notice Board is the starter in slot `noticeboard`, one per suit.
const boards = BASE_GAME_DATA.cards.catalogue
  .filter((c) => c.slot === 'noticeboard')
  .map((c) => c.id);

const board4: Overlay = {
  name: 'board-4',
  description: 'ticket 36 probe',
  schemaVersion: 1,
  set: Object.fromEntries(
    boards.flatMap((id) => [
      [`cards.catalogue.${id}.faces.starter.threshold`, 4],
      [`cards.catalogue.${id}.faces.upgraded.threshold`, 4],
    ]),
  ),
} as unknown as Overlay;

const pay3: Overlay = {
  name: 'pay3',
  description: 'ticket 36 probe',
  schemaVersion: 1,
  set: {
    'rules.economy.visitPayout.base': 3,
    'rules.economy.visitPayout.upgraded': 4,
    'rules.economy.visitPayout.twoCard': 5,
  },
} as unknown as Overlay;

interface Arm {
  readonly name: string;
  readonly data: GameData;
  readonly veto: WeightTable;
  readonly ref: WeightTable;
}

const ARMS: Arm[] = [
  { name: 'base', data: BASE_GAME_DATA, veto: VETO, ref: REF },
  { name: 'pay3', data: loadGameData(pay3), veto: VETO, ref: REF },
  { name: 'no-free-work', data: BASE_GAME_DATA, veto: VETO_NW, ref: REF_NW },
  { name: 'board-4', data: loadGameData(board4), veto: VETO, ref: REF },
];

console.log('\nabstainer vs reference, 2 seats, every suit cell x both orders');
console.log('plus the abstainer MIRROR, which is what locks\n');
console.log(
  'arm            duels  ended  abstainer win%   visits/turn   VP (abst / ref)   mirror lock%',
);

for (const arm of ARMS) {
  const cells = cellsFor(2, arm.data.island.decksInPlayBySeats['2'] ?? 3);
  let games = 0;
  let done = 0;
  let wins = 0;
  let vetoVp = 0;
  let refVp = 0;
  let visits = 0;
  let turns = 0;
  for (const cell of cells) {
    for (const order of [0, 1]) {
      games += 1;
      const names = order === 0 ? ['veto', 'ref'] : ['ref', 'veto'];
      const result = runGame(arm.data, {
        seed: `t36d:${arm.name}:${cell.label}:${order}`,
        seats: 2,
        suits: cell.suits as readonly Suit[],
        neutralSuits: cell.neutral as readonly Suit[],
        policies: names.map((n) => scoredPolicy(n, n === 'veto' ? arm.veto : arm.ref)),
        maxMoves: 6000,
        observe: (d) => {
          for (const e of d.events) if (e.e === 'visited') visits += 1;
        },
      });
      turns += result.turns;
      if (!result.ended) continue;
      done += 1;
      const s = score(arm.data, result.state);
      const spot = names.indexOf('veto');
      if ((s.ranking[0] as number) === spot) wins += 1;
      vetoVp += s.seats[spot]?.total ?? 0;
      refVp += s.seats[1 - spot]?.total ?? 0;
    }
  }

  // The mirror: both seats abstain. Part B's lock finding, re-run per arm.
  let mGames = 0;
  let mLocked = 0;
  for (const cell of cells) {
    mGames += 1;
    const r = runGame(arm.data, {
      seed: `t36d:mirror:${arm.name}:${cell.label}`,
      seats: 2,
      suits: cell.suits as readonly Suit[],
      neutralSuits: cell.neutral as readonly Suit[],
      policies: [scoredPolicy('veto', arm.veto), scoredPolicy('veto', arm.veto)],
      maxMoves: 6000,
    });
    if (r.outcome === 'stalled') mLocked += 1;
  }

  const p = wins / done;
  const se = Math.sqrt((p * (1 - p)) / done);
  console.log(
    `${arm.name.padEnd(14)} ${String(games).padStart(5)}  ${String(done).padStart(5)}  ${(100 * p).toFixed(1).padStart(9)} +-${(100 * 1.96 * se).toFixed(1).padStart(4)}   ${(visits / turns).toFixed(3).padStart(11)}   ${(vetoVp / done).toFixed(1).padStart(6)} / ${(refVp / done).toFixed(1).padEnd(6)}   ${((100 * mLocked) / mGames).toFixed(0).padStart(11)}%`,
  );
}
