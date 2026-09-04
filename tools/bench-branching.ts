/**
 * THE BRANCHING AND THROUGHPUT BENCH: worst-case legal moves per position, and
 * seconds per 2-seat game, for one arm.
 *
 * ⛔ WHY IT EXISTS, AND IT IS NOT A CONVENIENCE. Two numbers have decided two
 * rules in this project and both were measured ad hoc, which is why neither
 * could be re-run: the hand limit came back on 02/09/2026 because the worst
 * position offered 116,535 legal moves and a 2-seat game took 91.5 seconds, and
 * it was cut from 12 to 7 on 03/09/2026 because 330 payments per buildable card
 * put the balance suite at twelve hours. Handoff v2 (04/09/2026) puts up to ten
 * MEEPLES into the same payment enumerator and makes the gate explicit: measure
 * worst-case legal moves and seconds per 2-seat game against the v1 arm BEFORE
 * running the suite, and stop if either has moved by more than 2x.
 *
 * ⚠️ THE MACHINE SWINGS ~1.6x BY STATE (04/09/2026, recorded in Dean's memory:
 * the same baseline code read 83.7s and 138.2s on two runs). So the SECONDS
 * number is only ever read as an A/B taken close together, never against a
 * figure quoted in a document from another day. The LEGAL MOVES number is
 * deterministic and may be quoted anywhere.
 *
 * Usage:
 *   npx tsx tools/bench-branching.ts [--overlay=overlays/x.overlay.json]
 *                                    [--games=12] [--seats=2] [--seed=reference-v11]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import type { GameData, Overlay, Suit } from '@gp/data';
import { BASE_GAME_DATA, loadGameData, validateOverlay } from '@gp/data';
import {
  anyBalloonMoveOption,
  anyBuildOption,
  anyDeliverOption,
  buildOptions,
  balloonMoveOptions,
  deliverOptions,
  growOptions,
  harvestOptions,
} from '../packages/engine/src/actions.js';
import { drawableSuits } from '../packages/engine/src/query.js';
import { runGame } from '../packages/sim/src/driver.js';
import { cellsFor } from '../packages/sim/src/reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function flag(argv: readonly string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function dataFor(path: string | null): { data: GameData; name: string } {
  if (path === null) return { data: BASE_GAME_DATA, name: 'default (shipped rules)' };
  const overlay = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Overlay;
  validateOverlay(overlay, BASE_GAME_DATA);
  return { data: loadGameData(overlay), name: overlay.name };
}

const argv = process.argv.slice(2);
const { data, name } = dataFor(flag(argv, 'overlay'));
const games = Number(flag(argv, 'games') ?? 12);
const seats = Number(flag(argv, 'seats') ?? 2);
const seed = flag(argv, 'seed') ?? 'reference-v11';
/** --audit walks the gate-versus-enumerator check. Slow; off by default. */
const audit = argv.includes('--audit');

// The same stratified cells the balance run uses, so the positions measured are
// positions the suite will actually meet rather than a hand-picked table. Every
// reference from v9 on plays seats + 1 decks.
const cells = cellsFor(seats, seats + 1);

let worst = 0;
let worstAt = '';
let positions = 0;
let totalMoves = 0;
/** Legal moves per position, kept for the tail: a mean hides a single explosion. */
const counts: number[] = [];
const byType = new Map<string, number>();
const outcomes = new Map<string, number>();
// ⚠️ READ THESE TWO BESIDE THE HEADLINE. The widest list in this game has been
// the end-of-turn `discard` task since 03/09/2026 (the OTHER C(n, k)), and it is
// untouched by anything handoff v2 does - meeples are not cards in hand. So a
// headline dominated by a task can hide, or invent, a move in the half of the
// enumeration that DID change. `worstMoves` is the worst position counting turn
// moves only, and `worstBuild` is the worst single build enumeration, which is
// the number the hand limit was cut for on 03/09/2026.
let worstMoves = 0;
let worstBuild = 0;
// The hand is the other half of every C(n, k) in this game, and the discard
// task is the widest list in it (03/09/2026). A branching number that moved
// without the hand moving is a change to the payment enumerator; one that moved
// WITH the hand is a change to the game.
let worstHand = 0;
// ⚠️ THE GATE-VERSUS-ENUMERATOR AUDIT. `hasMainOption` answers "is any main
// action legal" with the fast `any*` predicates, and `legalMoves` answers it by
// enumerating; `pass` is offered when the enumeration is empty and `apply`
// re-checks with the gate, so ONE disagreement is a crash. This walks every
// position and names which of the six disagreed, which is the only way to turn
// a 2-in-4820 crash into a fix.
const disagreements = new Map<string, string>();
const errors = new Map<string, string>();

const started = process.hrtime.bigint();
for (let i = 0; i < games; i++) {
  const cell = cells[i % cells.length];
  if (cell === undefined) break;
  const gameSeed = `${seed}:bench:${i}`;
  const res = runGame(data, {
    seed: gameSeed,
    seats,
    suits: cell.suits as readonly Suit[],
    neutralSuits: cell.neutral as readonly Suit[],
    policies: Array.from({ length: seats }, () => 'balanced' as const),
    observe: (d) => {
      const n = d.legal.length;
      positions += 1;
      totalMoves += n;
      counts.push(n);
      if (audit) {
        const st = d.pre;
        const seat = d.seat;
        const pairs: [string, boolean, boolean][] = [
          ['draw', drawableSuits(data, st).length > 0, drawableSuits(data, st).length > 0],
          ['build', anyBuildOption(data, st, seat), buildOptions(data, st, seat).length > 0],
          ['grow', growOptions(data, st, seat).length > 0, growOptions(data, st, seat).length > 0],
          [
            'harvest',
            harvestOptions(data, st, seat).length > 0,
            harvestOptions(data, st, seat).length > 0,
          ],
          ['deliver', anyDeliverOption(data, st, seat), deliverOptions(data, st, seat).length > 0],
          [
            'balloon',
            anyBalloonMoveOption(data, st, seat),
            balloonMoveOptions(data, st, seat).length > 0,
          ],
        ];
        for (const [name, gate, enumerated] of pairs) {
          if (gate !== enumerated && !disagreements.has(name)) {
            disagreements.set(name, `${gameSeed} turn ${st.turnPlayer} gate=${gate} enum=${enumerated}`);
          }
        }
      }
      let turnMoves = 0;
      let builds = 0;
      for (const m of d.legal) {
        if (m.type !== 'task') turnMoves += 1;
        if (m.type === 'build') builds += 1;
      }
      for (const pl of d.pre.players) if (pl.hand.length > worstHand) worstHand = pl.hand.length;
      if (turnMoves > worstMoves) worstMoves = turnMoves;
      if (builds > worstBuild) worstBuild = builds;
      if (n > worst) {
        worst = n;
        worstAt = gameSeed;
        byType.clear();
        for (const m of d.legal) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
      }
    },
  });
  outcomes.set(res.outcome, (outcomes.get(res.outcome) ?? 0) + 1);
  if (res.outcome === 'crashed' && errors.size < 5) errors.set(res.error ?? '?', gameSeed);
}
const elapsed = Number(process.hrtime.bigint() - started) / 1e9;

counts.sort((a, b) => a - b);
const at = (q: number): number => counts[Math.min(counts.length - 1, Math.floor(q * counts.length))] ?? 0;

process.stdout.write(
  [
    `arm:                    ${name}`,
    `seed:                   ${seed}`,
    `games / seats:          ${games} / ${seats}`,
    `positions:              ${positions}`,
    `WORST LEGAL MOVES:      ${worst}   (at ${worstAt})`,
    `  by move type:         ${[...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`,
    `WORST TURN MOVES:       ${worstMoves}   (the same positions, tasks excluded)`,
    `WORST HAND:             ${worstHand}   (the other half of every C(n, k) here)`,
    `WORST BUILD PAYMENTS:   ${worstBuild}   (one position's build list)`,
    `median legal moves:     ${at(0.5)}`,
    `p95 legal moves:        ${at(0.95)}`,
    `p99 legal moves:        ${at(0.99)}`,
    `mean legal moves:       ${(totalMoves / Math.max(1, positions)).toFixed(1)}`,
    ...(audit
      ? [
          `GATE vs ENUMERATOR:     ${
            disagreements.size === 0
              ? 'agree everywhere'
              : [...disagreements].map(([k, v]) => `${k} DISAGREES (${v})`).join('; ')
          }`,
        ]
      : []),
    `outcomes:               ${[...outcomes].map(([o, n]) => `${o} ${n}`).join(', ')}`,
    ...[...errors].map(([e, sd]) => `  ! ${e}   (${sd})`),
    `SECONDS PER GAME:       ${(elapsed / games).toFixed(3)}   (${elapsed.toFixed(1)}s total)`,
    '',
  ].join('\n'),
);
