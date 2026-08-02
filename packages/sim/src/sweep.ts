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
import type { Pooled, RunOptions } from './run.js';
import { pool, runBalance } from './run.js';
import { median, num, pct, sum } from './stats.js';

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
    const result = runBalance(data, {
      ...input.opts,
      seed: `${input.opts.seed ?? input.opts.reference.seed}:sweep:${cell.label}`,
      onGame: undefined,
    });
    return { label: cell.label, data, pooled: pool(result) };
  });

  const out: string[] = [];
  out.push('='.repeat(96));
  out.push(`Sweep: ${input.path}`);
  out.push('='.repeat(96));
  out.push(
    `Deltas against ${input.opts.reference.id}. Absolute values are in brackets; the delta is the answer.`,
  );
  out.push('');

  const metrics: { label: string; of: (p: Pooled) => number; fmt: (x: number) => string }[] = [
    { label: 'end coins per player', of: endCoins, fmt: (x) => `£${num(x, 1)}` },
    { label: 'barn at game end', of: endBarn, fmt: (x) => num(x, 1) },
    {
      label: 'game length, rounds',
      of: (p) => median(p.ended.map((g) => g.rounds)),
      fmt: (x) => num(x, 1),
    },
    { label: 'visits per turn', of: visitsPerTurn, fmt: (x) => num(x, 2) },
    {
      label: 'unfinished games',
      of: (p) => 1 - p.ended.length / Math.max(1, p.all.length),
      fmt: (x) => pct(x, 1),
    },
    { label: 'winning score', of: winningScore, fmt: (x) => num(x, 1) },
  ];

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

function endCoins(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.coinsByRound.slice(-1)));
}

function endBarn(p: Pooled): number {
  return median(p.ended.flatMap((g) => g.barnByRound.slice(-1)));
}

function visitsPerTurn(p: Pooled): number {
  const turns = sum(p.ended.map((g) => sum(g.turnsBySeat)));
  return turns === 0 ? NaN : sum(p.ended.map((g) => sum(g.visitsBySeat))) / turns;
}

function winningScore(p: Pooled): number {
  return median(
    p.ended.flatMap((g) => (g.winner === null ? [] : [g.scores[g.winner]?.total ?? NaN])),
  );
}

function delta(x: number, fmt: (n: number) => string): string {
  if (!Number.isFinite(x)) return '-';
  return `${x >= 0 ? '+' : '-'}${fmt(Math.abs(x))}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)} ` : s.padEnd(n);
}
