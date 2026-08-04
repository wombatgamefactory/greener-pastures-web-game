/**
 * THROWAWAY - re-record the three full-game regression fixtures.
 *
 * The card buy (2026-08-03) changes the TURN BOUNDARY: a seat holding coins now
 * has an unspent free action, so `settleTurn` no longer auto-ends its turn and
 * every recorded log diverges at the first boundary. That is a stale fixture,
 * not a regression - the fixtures' own test says so in as many words - so they
 * are re-recorded against the new rules from the same seeds, seats, suits and
 * policies, and keep their original `why`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { BASE_GAME_DATA } from '@gp/data';
import type { Suit } from '@gp/data';
import { makeCapture, toFixture } from '@gp/engine';

import { runGame } from './src/driver.js';

const DIR = fileURLToPath(new URL('./fixtures', import.meta.url));

const SPECS = [
  {
    file: '2p-capture-probe-2p.json',
    seed: 'capture-probe-2p',
    seats: 2,
    suits: ['wheat', 'vegetable'] as Suit[],
    neutralSuits: ['orchard'] as Suit[],
    why: 'A full 2-seat game to the Level 3 trigger. Two seats is where the level gate, the clog-denial line and the supply lock bite hardest.',
  },
  {
    file: '3p-capture-probe-1.json',
    seed: 'capture-probe-1',
    seats: 3,
    suits: ['wheat', 'vegetable', 'orchard'] as Suit[],
    neutralSuits: ['apiary'] as Suit[],
    why: 'A full 3-seat game that reaches the Level 3 end trigger. Guards the whole turn flow, the island and every suit’s handlers against a change that makes a legal line illegal.',
  },
  {
    file: '4p-capture-probe-4p.json',
    seed: 'capture-probe-4p',
    seats: 4,
    suits: ['wheat', 'vegetable', 'orchard', 'apiary'] as Suit[],
    neutralSuits: ['dairy'] as Suit[],
    why: 'A full 4-seat game to the Level 3 trigger, with all five suits and the Aerodrome in play. The widest move surface the engine offers.',
  },
];

for (const spec of SPECS) {
  const policies = Array.from({ length: spec.seats }, () => 'balanced' as const);
  const result = runGame(BASE_GAME_DATA, {
    seed: spec.seed,
    seats: spec.seats,
    suits: spec.suits,
    neutralSuits: spec.neutralSuits,
    policies,
    maxMoves: 5000,
  });
  const capture = makeCapture({
    label: 'note',
    note: '',
    at: '2026-08-03T00:00:00.000Z',
    origin: 'sim',
    dataFingerprint: result.state.dataFingerprint,
    setup: {
      seed: spec.seed,
      seats: spec.seats,
      suits: spec.suits,
      neutralSuits: spec.neutralSuits,
    },
    policies,
    moves: result.moves,
    seat: result.state.turnPlayer,
    turn: result.turns,
  });
  const fixture = toFixture(capture, spec.why, result.outcome === 'crashed' ? 'throws' : 'plays');
  writeFileSync(join(DIR, spec.file), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(
    `${spec.file}: ${result.outcome}, ${result.moves.length} moves, ${result.turns} turns`,
  );
}
