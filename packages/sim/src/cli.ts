/**
 * gp-sim - the headless balance simulator.
 *
 * Runs the same @gp/engine the browser runs, driven by the same @gp/bots the
 * browser's difficulty ladder uses. The harness, metrics and the v14 watch-list
 * assertion suite were designed in wayfinder ticket 11 and built in ticket 35.
 *
 * The verdict lives HERE and only here. Ticket 11 section 3: a failing
 * watch-list assertion means the game's balance is off, not that the code is
 * broken, so it must never sit in `npm run check` - a red assertion 2 blocking
 * an unrelated commit turns the pressure into loosening the threshold, which
 * destroys the instrument. CI runs a smoke test that the metrics COMPUTE, and
 * never that the design passes.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';
import { BASE_GAME_DATA, SUITS, listKnobs, loadGameData, validateOverlay } from '@gp/data';
import type { Overlay, Suit } from '@gp/data';
import { LADDER, POLICY_IDS, isPolicyId } from '@gp/bots';

import { explainReport } from './explain.js';
import { runNoise } from './noise.js';
import { REFERENCE } from './reference.js';
import { crashWriter, replayReport } from './replay.js';
import { planRun, pool, runBalance } from './run.js';
import { renderReport } from './report.js';
import { runSweep } from './sweep.js';
import { failures, runMirrors, runWatchlist } from './watchlist.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Overlay and sweep paths resolve against the REPO ROOT, not the process cwd.
 * `npm run sim` runs inside packages/sim, so `overlays/wage-shrink.overlay.json`
 * - which is what every assertion's remedy field prints, and what a reader will
 * paste - would otherwise resolve to a path that does not exist.
 */
function fromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

const HELP = [
  'gp-sim - Greener Pastures balance simulator',
  '',
  'Usage: npm run sim -- [options]',
  '',
  '  --watchlist         Run the balance suite and write a report to /reports/.',
  '    --n=<games>       Target games per seat count (default 500, rounded up to whole cells).',
  '    --seed=<string>   Run seed (default reference-v1). A new seed is a new SAMPLE, not a',
  '                      new reference.',
  '    --seats=2,3,4     Which seat counts to run.',
  '    --mirrors=<n>     Games per seat count for each of the four mirror diagnostics',
  '                      (default 60; 0 skips them, and the taste assertions lose their spread).',
  '    --overlay=<path>  Run the whole suite under a tuning overlay.',
  '    --full-funnel     Append the 105-row funnel table. The cut list is the point.',
  '    --quiet           No progress line.',
  '  --noise             Run the plan TWICE on two seeds, same rules both times, and print how',
  '                      far each metric moves. That movement is the noise floor: a delta smaller',
  '                      than it is not a result. Prints a NOISE_FLOOR literal to paste into',
  '                      reference.ts. Re-run after minting a reference; the floor does not',
  '                      carry across instruments, and it does not carry to a smaller --n.',
  '    --n=<games>       Games per seat count PER ARM. Use the reference n; a small run',
  '                      overstates the floor enormously and is worse than not measuring it.',
  '  --sweep=<path>      Delta table against the reference, for an overlay or a sweep file.',
  '                      Failure-driven: run one when an assertion FAILs and prints its remedy,',
  '                      or for the two intrinsically paired questions. Arms are PAIRED: every',
  '                      arm runs on the same seed, so they share their deck order until the',
  '                      changed rule makes them diverge.',
  '  --replay=<path>     Replay a captured bug report or design note (ticket 31) and print what',
  '                      it does. Exit 0 replayed clean, 1 reproduced a throw, 2 the data has',
  '                      moved on since the capture.',
  '    --force           Replay anyway when the data has moved on. The record always prints.',
  '    --fixture=<why>   Also write a public-side regression fixture, stripped of the note.',
  '    --top=<n>         How many legal moves per type to print at the failure (default 4).',
  '  --list-knobs        Print every tunable value an overlay or a sweep may address.',
  '  --list-bots         Print the roster and the difficulty ladder.',
  '  --explain           Print the per-term breakdown behind one bot decision.',
  '    --policy=<id>     Which bot to explain (default: balanced).',
  '    --seed=<string>   Game seed (default: explain).',
  '    --seats=<n>       2-4 (default: 2).',
  '    --at=<n>          Which decision; negative counts back from the last (default: -1).',
  '    --top=<n>         How many moves to list (default: 6).',
  '  -h, --help          This.',
  '',
  'Exits non-zero when any watch-list assertion FAILs, so a scripted sweep can branch on it.',
  'Nothing in `npm run check` depends on that exit code, deliberately.',
  '',
].join('\n');

function flag(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function listKnobsReport(): string {
  const knobs = listKnobs(BASE_GAME_DATA);
  const width = Math.max(...knobs.map((knob) => knob.path.length));
  const lines = [
    `${knobs.length} knobs. Any of these may be set by a tuning overlay or swept.`,
    'Card text is deliberately absent: the sheet is the single source of truth for wording.',
    '',
  ];
  for (const knob of knobs) {
    const value = Array.isArray(knob.baseValue)
      ? `[${knob.baseValue.join(', ')}]`
      : String(knob.baseValue);
    lines.push(`  ${knob.path.padEnd(width)}  ${value.padStart(9)}  ${knob.type}`);
  }
  return `${lines.join('\n')}\n`;
}

function listBotsReport(): string {
  return [
    `${POLICY_IDS.length} bots: ${POLICY_IDS.join(', ')}.`,
    `Ladder: easy = ${LADDER.easy}, normal = ${LADDER.normal}, hard = ${LADDER.hard}.`,
    '',
    '`hard` is an alias, not a claim. Ticket 11 gave it a condition rather than a winner: the',
    'top profile earns the label only if its win rate is separated from the field by more than',
    'its confidence interval. Run --watchlist and read the BOTS table.',
    '',
  ].join('\n');
}

function explainMode(argv: readonly string[]): { report: string; code: number } {
  const policy = flag(argv, 'policy') ?? 'balanced';
  if (!isPolicyId(policy)) {
    return { report: `Unknown bot "${policy}". Try --list-bots.\n`, code: 1 };
  }
  const seats = Number(flag(argv, 'seats') ?? 2);
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) {
    return { report: '--seats must be 2, 3 or 4.\n', code: 1 };
  }
  const report = explainReport(BASE_GAME_DATA, {
    seed: flag(argv, 'seed') ?? 'explain',
    seats,
    suits: SUITS.slice(0, seats) as Suit[],
    policy,
    at: Number(flag(argv, 'at') ?? -1),
    top: Number(flag(argv, 'top') ?? 6),
  });
  return { report, code: 0 };
}

function loadOverlay(path: string): { overlay: Overlay; name: string } {
  const overlay = JSON.parse(readFileSync(fromRoot(path), 'utf8')) as Overlay;
  validateOverlay(overlay, BASE_GAME_DATA);
  return { overlay, name: overlay.name };
}

function seatCountsFrom(argv: readonly string[]): number[] | null {
  const raw = flag(argv, 'seats');
  if (raw === null) return null;
  const seats = raw.split(',').map((s) => Number(s.trim()));
  if (seats.some((s) => !Number.isInteger(s) || s < 2 || s > 4)) return null;
  return seats;
}

function baseOptions(argv: readonly string[]) {
  const seatCounts = seatCountsFrom(argv);
  const n = flag(argv, 'n');
  return {
    reference: REFERENCE,
    seed: flag(argv, 'seed') ?? REFERENCE.seed,
    ...(n === null ? {} : { games: Number(n) }),
    ...(seatCounts === null ? {} : { seatCounts }),
  };
}

function progress(quiet: boolean): ((done: number, total: number) => void) | undefined {
  if (quiet) return undefined;
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (done !== total && now - last < 750) return;
    last = now;
    process.stderr.write(`\r  ${done} / ${total} games   `);
    if (done === total) process.stderr.write('\n');
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function write(name: string, report: string): string {
  const dir = join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, report, 'utf8');
  return file;
}

function watchlistMode(argv: readonly string[]): number {
  const quiet = argv.includes('--quiet');
  const overlayPath = flag(argv, 'overlay');
  const loaded = overlayPath === null ? null : loadOverlay(overlayPath);
  const data = loaded === null ? BASE_GAME_DATA : loadGameData(loaded.overlay);
  const crashes = crashWriter(CAPTURE_DIR);
  const opts = {
    ...baseOptions(argv),
    onGame: progress(quiet),
    onCrash: crashes.onCrash,
    overlay: loaded?.name ?? null,
  };

  const plan = planRun(data, opts);
  if (!quiet) {
    process.stderr.write(
      `${REFERENCE.id}: ${plan.total} games across ${plan.cells.length} stratified cells\n`,
    );
  }
  const result = runBalance(data, opts);
  if (!quiet) process.stderr.write(crashes.summary());
  const pooled = pool(result);

  const mirrorGames = Number(flag(argv, 'mirrors') ?? 60);
  if (!quiet && mirrorGames > 0) process.stderr.write('  mirror diagnostics...\n');
  const mirrors = runMirrors(data, { ...opts, onGame: undefined }, mirrorGames);

  const rows = runWatchlist(data, pooled, mirrors);
  const report = renderReport({
    data,
    result,
    pooled,
    rows,
    mirrorGames,
    overlayName: loaded?.name ?? null,
    fullFunnel: argv.includes('--full-funnel'),
  });

  const file = write(
    `watchlist-${stamp()}-${REFERENCE.id}${loaded ? `-${loaded.name}` : ''}.txt`,
    report,
  );
  process.stdout.write(report);
  process.stdout.write(`\nWritten to ${file}\n`);
  return failures(rows).length > 0 ? 1 : 0;
}

function noiseMode(argv: readonly string[]): number {
  const quiet = argv.includes('--quiet');
  const report = runNoise({
    data: BASE_GAME_DATA,
    opts: { ...baseOptions(argv), onGame: progress(quiet) },
    onArm: quiet ? undefined : (label) => process.stderr.write(`${label}...\n`),
  });
  const file = write(`noise-${stamp()}-${REFERENCE.id}.txt`, report);
  process.stdout.write(report);
  process.stdout.write(`\nWritten to ${file}\n`);
  return 0;
}

function sweepMode(argv: readonly string[], path: string): number {
  const quiet = argv.includes('--quiet');
  const opts = { ...baseOptions(argv), onGame: progress(quiet) };
  if (!quiet) process.stderr.write('baseline for the sweep...\n');
  const baseline = pool(runBalance(BASE_GAME_DATA, opts));
  if (!quiet) process.stderr.write('sweep cells...\n');
  const report = runSweep({
    path: fromRoot(path),
    baseline,
    baselineData: BASE_GAME_DATA,
    opts: { ...opts, onGame: progress(quiet) },
  });
  const file = write(`sweep-${stamp()}.txt`, report);
  process.stdout.write(report);
  process.stdout.write(`\nWritten to ${file}\n`);
  return 0;
}

/**
 * Where captures land. Gitignored, because a report carries the game's weak
 * spots and Dean's own notes, and this repo goes public.
 *
 * The browser downloads to wherever the browser downloads to - ticket 31 chose
 * a plain file over a dev-server endpoint precisely so the button works on the
 * deployed build - so this is the SUGGESTED home rather than an enforced one,
 * and `--replay` takes any path.
 */
const CAPTURE_DIR = join(ROOT, 'captures');

/** Fixtures are the public half: setup and move log, never a note. */
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function replayMode(argv: readonly string[], path: string): number {
  const { report, code } = replayReport(BASE_GAME_DATA, {
    path: fromRoot(path),
    force: argv.includes('--force'),
    fixture: flag(argv, 'fixture'),
    fixtureDir: FIXTURE_DIR,
    top: Number(flag(argv, 'top') ?? 4),
  });
  process.stdout.write(report);
  return code;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv.includes('--list-knobs')) {
    process.stdout.write(listKnobsReport());
    return 0;
  }

  if (argv.includes('--list-bots')) {
    process.stdout.write(listBotsReport());
    return 0;
  }

  if (argv.includes('--explain')) {
    const { report, code } = explainMode(argv);
    process.stdout.write(report);
    return code;
  }

  const replay = flag(argv, 'replay');
  if (replay !== null) return replayMode(argv, replay);

  if (argv.includes('--noise')) return noiseMode(argv);

  const sweep = flag(argv, 'sweep');
  if (sweep !== null) return sweepMode(argv, sweep);

  if (argv.includes('--watchlist')) return watchlistMode(argv);

  process.stdout.write(
    `gp-sim: engine ${ENGINE_VERSION}, rules ${RULES_EDITION}, ` +
      `${BASE_GAME_DATA.cards.catalogue.length} cards, ${POLICY_IDS.length} bots loaded.\n` +
      'Run `npm run sim -- --watchlist` for the balance suite, or -h for everything else.\n',
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
