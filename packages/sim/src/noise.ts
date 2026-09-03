/**
 * `--noise` - measure the noise floor, once, so every other number has a
 * threshold to be read against.
 *
 * The situation this closes: the harness has run sixty-odd reports and every
 * sweep in `reports/` prints a delta table, and until 2026-08-08 nothing in the
 * project said how big a delta has to be before it is a fact about the rules
 * rather than about which deck came out of the shuffler. The method document's
 * section 8 opens with it, and it is the cheapest credibility available:
 * "measure the noise floor once, per project, and then quote it constantly."
 *
 * The hypothesis is null by construction. Both arms run the SAME rules, the SAME
 * cell plan, the SAME bots and the SAME `n`. Only the seed differs. So every
 * difference this prints is, by definition, sampling noise, and it is the
 * smallest difference a real finding has to beat.
 *
 * How to read the output. The `movement` column is |arm A - arm B| in the
 * metric's own units. A sweep cell that moves a metric by less than its movement
 * here has not moved it. Two things follow that are worth saying out loud,
 * because both have bitten this project's neighbours:
 *
 *   - The floor is a function of `n`. At n=60 per seat count the seat deviation
 *     moved 23.7 points, which is larger than any effect the design could
 *     plausibly have; at n=500 it moved 5.7. An exploratory run cannot rule
 *     anything out, and quoting one as though it could is the failure mode.
 *   - Two arms give ONE observation of the movement, not a distribution. It is a
 *     rough bound, honestly rough, and the method prefers it to a computed
 *     confidence interval precisely because nobody pretends it is more than that.
 *
 * The output ends with a `NOISE_FLOOR` literal ready to paste into
 * `reference.ts`, which is where the report and the sweep header read it from.
 */

import type { GameData } from '@gp/data';

import { HEADLINE_METRICS } from './metrics.js';
import { REFERENCE } from './reference.js';
import type { RunOptions } from './run.js';
import { pool, runBalance } from './run.js';
import { num } from './stats.js';

export interface NoiseInput {
  readonly data: GameData;
  readonly opts: RunOptions;
  /** Progress line, per arm. */
  readonly onArm?: ((label: string) => void) | undefined;
}

export async function runNoise(input: NoiseInput): Promise<string> {
  const base = input.opts.seed ?? input.opts.reference.seed;

  input.onArm?.('arm A');
  const a = pool(await runBalance(input.data, { ...input.opts, seed: `${base}:noise:A` }));
  input.onArm?.('arm B');
  const b = pool(await runBalance(input.data, { ...input.opts, seed: `${base}:noise:B` }));

  const games = Math.max(
    ...input.opts.reference.seatCounts.map(
      (s) => input.opts.games ?? input.opts.reference.targetGames[s] ?? 0,
    ),
  );

  const out: string[] = [];
  out.push('='.repeat(96));
  out.push('Greener Pastures - the noise floor');
  out.push('='.repeat(96));
  out.push(`reference   ${input.opts.reference.id}`);
  out.push(`seeds       ${base}:noise:A  against  ${base}:noise:B`);
  out.push(`games       ${a.all.length} per arm, target ${games} per seat count`);
  out.push(`data        ${input.data.cards.meta.sourceSha256 ?? 'unknown'}`);
  out.push('');
  out.push('Two IDENTICAL runs. Same rules, same plan, same bots, different seed - so every');
  out.push('difference below is sampling noise, and is the smallest difference a real finding');
  out.push('has to beat. The floor is a function of n: it does not carry to a smaller run.');
  out.push('');
  out.push("A movement of 0 means BELOW THIS METRIC'S RESOLUTION, not noiseless: most of these");
  out.push('are medians over discrete quantities, so both arms land on the same integer and the');
  out.push('difference is floored at zero. Read those as "one unit", not as "any delta is real".');
  out.push('');

  const width = 30;
  out.push(pad('metric', width) + pad('arm A', 16) + pad('arm B', 16) + 'movement');
  const movement: Record<string, number> = {};
  for (const metric of HEADLINE_METRICS) {
    const x = metric.of(a);
    const y = metric.of(b);
    const move = Math.abs(x - y);
    movement[metric.label] = Number.isFinite(move) ? Number(move.toFixed(3)) : NaN;
    out.push(
      pad(metric.label, width) +
        pad(metric.fmt(x), 16) +
        pad(metric.fmt(y), 16) +
        (Number.isFinite(move) ? metric.fmt(move) : '-'),
    );
  }

  out.push('');
  out.push('Per chair, which is the metric the band is stated for:');
  out.push(pad('', 12) + pad('seat', 8) + pad('arm A dev', 14) + pad('arm B dev', 14) + 'movement');
  for (const sliceA of a.bySeats) {
    const sliceB = b.bySeats.find((s) => s.seats === sliceA.seats);
    if (!sliceB) continue;
    const even = 1 / sliceA.seats;
    for (const seatA of sliceA.bySeatIndex) {
      const seatB = sliceB.bySeatIndex[seatA.seat];
      if (!seatB) continue;
      const devA = (seatA.wins / Math.max(1, seatA.games) - even) * 100;
      const devB = (seatB.wins / Math.max(1, seatB.games) - even) * 100;
      out.push(
        pad(`${sliceA.seats}p`, 12) +
          pad(String(seatA.seat), 8) +
          pad(`${devA >= 0 ? '+' : ''}${num(devA, 1)} pts`, 14) +
          pad(`${devB >= 0 ? '+' : ''}${num(devB, 1)} pts`, 14) +
          `${num(Math.abs(devA - devB), 1)} pts`,
      );
    }
  }

  out.push('');
  out.push('Paste into reference.ts, replacing NOISE_FLOOR:');
  out.push('');
  out.push('export const NOISE_FLOOR: NoiseFloor | null = {');
  out.push(`  reference: '${input.opts.reference.id}',`);
  out.push(`  games: ${games},`);
  out.push(`  measured: '${new Date().toISOString().slice(0, 10)}',`);
  out.push('  movement: {');
  for (const [label, value] of Object.entries(movement)) {
    out.push(`    ${JSON.stringify(label)}: ${Number.isFinite(value) ? value : 'NaN'},`);
  }
  out.push('  },');
  out.push('};');
  out.push('');
  if (input.opts.reference.id !== REFERENCE.id) {
    out.push(
      `NOTE: measured against ${input.opts.reference.id} while the live reference is ` +
        `${REFERENCE.id}. Do not record it.`,
    );
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)} ` : s.padEnd(n);
}
