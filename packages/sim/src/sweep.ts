/**
 * Sweep mode: a delta table against `reference-v1`, never a fresh absolute
 * report.
 *
 * 670 knobs and a cheap runtime is an invitation to sweep everything, which is
 * a research programme rather than a deliverable. So ticket 11 section 9 allows
 * a sweep in exactly two cases, and this tool exists to serve those two:
 *
 *   1. testing a FAILing assertion's own PRESCRIBED remedy overlay, or
 *   2. an intrinsically PAIRED assertion - the Bread Hall on versus off, and
 *      `island.levelGate`, which switches a rule off rather than moving a
 *      number and so only ever reads as a comparison.
 *
 * The absolute numbers in a swept cell are not the point and are deliberately
 * hard to read off: what a sweep answers is "did the prescribed fix move the
 * thing it was prescribed for, and what else did it move".
 */

import { readFileSync } from 'node:fs';

import type { GameData } from '@gp/data';
import { expandSweep, loadGameData, validateOverlay } from '@gp/data';
import type { Overlay, SweepCell, SweepFile } from '@gp/data';

import { WATCHLIST } from './assertions/index.js';
import { HEADLINE_METRICS } from './metrics.js';
import { NOISE_FLOOR, REFERENCE } from './reference.js';
import type { Pooled, RunOptions } from './run.js';
import { pool, runBalance } from './run.js';
import { num } from './stats.js';

export interface SweepInput {
  readonly path: string;
  readonly baseline: Pooled;
  readonly baselineData: GameData;
  readonly opts: RunOptions;
}

/** An overlay file is a one-cell sweep. Both forms land here. */
export function cellsFromFile(path: string, data: GameData): SweepCell[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Overlay | SweepFile;
  if ('sweep' in raw && Array.isArray(raw.sweep)) return expandSweep(raw as SweepFile);
  const overlay = raw as Overlay;
  validateOverlay(overlay, data);
  return [{ label: overlay.name, overlay }];
}

interface Row {
  readonly label: string;
  readonly data: GameData;
  readonly pooled: Pooled;
}

export function runSweep(input: SweepInput): string {
  const cells = cellsFromFile(input.path, input.baselineData);
  const rows: Row[] = cells.map((cell) => {
    const data = loadGameData(cell.overlay);
    // PAIRED, as of 2026-08-08. Every cell and the baseline arm run on the SAME
    // seed, so they get the same cell plan, the same profile assignment per
    // game, the same seating rotation and the same shuffles: common random
    // numbers, and the classic variance reduction for exactly this comparison.
    //
    // It used to append `:sweep:<label>` per cell, which gave every arm a fresh
    // sample, so each delta carried the rule's effect PLUS two independent
    // draws' worth of noise - and with no noise floor printed there was nothing
    // to read it against either. Trajectories still diverge the moment the
    // changed rule bites, which is the point; what the shared seed removes is
    // the difference that was there before either arm made a move.
    const result = runBalance(data, { ...input.opts, onGame: undefined });
    return { label: cell.label, data, pooled: pool(result) };
  });

  const out: string[] = [];
  out.push('='.repeat(96));
  out.push(`Sweep: ${input.path}`);
  out.push('='.repeat(96));
  out.push(
    `Deltas against ${input.opts.reference.id}. Absolute values are in brackets; the delta is the answer.`,
  );
  out.push(
    `Paired: every arm runs on seed "${input.opts.seed ?? input.opts.reference.seed}", so the ` +
      'arms share their deck order,',
  );
  out.push('seating rotation and profile assignment until the changed rule makes them diverge.');
  out.push('');
  // The noise floor belongs in the header of the table it bounds, not in a
  // footnote, and loudly when it is missing: a delta table with no threshold
  // invites reading a rounding difference as a result.
  out.push(...noiseHeader());
  out.push('');

  const metrics = HEADLINE_METRICS;

  const width = 30;
  out.push(
    pad('metric', width) +
      pad(`${input.opts.reference.id}`, 18) +
      rows.map((r) => pad(r.label, 26)).join(''),
  );
  for (const metric of metrics) {
    const base = metric.of(input.baseline);
    out.push(
      pad(metric.label, width) +
        pad(metric.fmt(base), 18) +
        rows
          .map((r) => {
            const v = metric.of(r.pooled);
            return pad(`${delta(v - base, metric.fmt)} [${metric.fmt(v)}]`, 26);
          })
          .join(''),
    );
  }
  out.push('');
  out.push('Watch-list assertion values:');
  out.push(
    pad('assertion', width) +
      pad(`${input.opts.reference.id}`, 18) +
      rows.map((r) => pad(r.label, 26)).join(''),
  );
  for (const assertion of WATCHLIST) {
    const base = assertion.measure({ data: input.baselineData, pooled: input.baseline });
    out.push(
      pad(`${assertion.id} ${assertion.title}`, width) +
        pad(`${num(base.value, 2)} ${base.verdict}`, 18) +
        rows
          .map((r) => {
            const m = assertion.measure({ data: r.data, pooled: r.pooled });
            return pad(`${num(m.value, 2)} ${m.verdict}`, 26);
          })
          .join(''),
    );
  }
  out.push('');
  return `${out.join('\n')}\n`;
}

function noiseHeader(): string[] {
  // Bound locally: an imported binding is not narrowed inside a callback.
  const floor = NOISE_FLOOR;
  if (floor === null) {
    return [
      '*** NO NOISE FLOOR MEASURED for this reference, so no delta below has a threshold. ***',
      '    Run `npm run sim -- --noise` and record the result in reference.ts before quoting',
      '    anything here. A delta smaller than the sampling noise is not a result.',
    ];
  }
  const stale =
    floor.reference === REFERENCE.id
      ? ''
      : `  *** measured against ${floor.reference}, not ${REFERENCE.id} - re-measure ***`;
  const quoted = HEADLINE_METRICS.map((m) => {
    const v = floor.movement[m.label];
    if (v === undefined || !Number.isFinite(v)) return null;
    // Zero is not "noiseless", it is "the two arms landed on the same integer".
    // Saying so here is the difference between a floor and a licence.
    return v === 0 ? `${m.label} <1 unit` : `${m.label} ${m.fmt(v)}`;
  }).filter((s): s is string => s !== null);
  return [
    `Noise floor (${floor.reference}, n=${floor.games}, measured ${floor.measured}).` +
      ` A delta below this is not a result:${stale}`,
    `  ${quoted.join('   ')}`,
    '  "<1 unit" is a median over a discrete quantity: both arms hit the same integer, so the',
    '  floor is one unit of whatever it counts, not zero.',
  ];
}

function delta(x: number, fmt: (n: number) => string): string {
  if (!Number.isFinite(x)) return '-';
  return `${x >= 0 ? '+' : '-'}${fmt(Math.abs(x))}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)} ` : s.padEnd(n);
}
